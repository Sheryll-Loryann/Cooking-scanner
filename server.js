import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const SCAN_PROMPT = `Look at this image and identify every food ingredient you can see. Return ONLY a JSON list, with no other text: [{"name": "beet", "quantity": 9, "unit": "whole", "category": "produce", "confidence": "high"}]. Rules: use simple, common ingredient names. unit: whole, bunch, jar, bottle, can, pack, or g. category: produce, protein, dairy, grain, condiment, drink, or other. Ignore packaging, dishes, utensils and non-food items. If an item is unclear, give your best guess and set confidence to low.`;

const UNITS = ["whole", "bunch", "jar", "bottle", "can", "pack", "g"];
const CATEGORIES = ["produce", "protein", "dairy", "grain", "condiment", "drink", "other"];
const CONFIDENCES = ["high", "medium", "low"];

// The key only ever lives here on the server; the front end never sees it.
const ai = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new ScanError(400, "That file isn't an image. Please choose a photo."));
        }
    },
});

class ScanError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

// Gemini sometimes wraps JSON in ```json fences or adds stray text; pull out the array.
function parseIngredientList(text) {
    const cleaned = (text || "").replace(/```(?:json)?/gi, "").trim();
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start === -1 || end < start) {
        throw new ScanError(502, "The scanner returned an unexpected answer. Please try again.");
    }

    let list;
    try {
        list = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        throw new ScanError(502, "The scanner returned an unexpected answer. Please try again.");
    }
    if (!Array.isArray(list)) {
        throw new ScanError(502, "The scanner returned an unexpected answer. Please try again.");
    }

    return list
        .filter((item) => item && typeof item.name === "string" && item.name.trim())
        .map((item) => {
            const quantity = Number(item.quantity);
            return {
                name: item.name.trim().toLowerCase(),
                quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
                unit: UNITS.includes(item.unit) ? item.unit : "whole",
                category: CATEGORIES.includes(item.category) ? item.category : "other",
                confidence: CONFIDENCES.includes(item.confidence) ? item.confidence : "low",
            };
        });
}

const app = express();

app.use(express.static(path.join(__dirname, "front")));

app.post("/api/scan", upload.single("image"), async (req, res, next) => {
    try {
        if (!ai) {
            throw new ScanError(500, "The server is missing GEMINI_API_KEY. Add it to the .env file and restart.");
        }
        if (!req.file) {
            throw new ScanError(400, "No photo received. Please choose a photo to scan.");
        }

        let response;
        try {
            response = await ai.models.generateContent({
                model: GEMINI_MODEL,
                contents: [
                    {
                        role: "user",
                        parts: [
                            { inlineData: { mimeType: req.file.mimetype, data: req.file.buffer.toString("base64") } },
                            { text: SCAN_PROMPT },
                        ],
                    },
                ],
                config: { responseMimeType: "application/json" },
            });
        } catch (err) {
            console.error("Gemini request failed:", err);
            throw new ScanError(502, "We couldn't reach the ingredient scanner. Please try again in a moment.");
        }

        const ingredients = parseIngredientList(response.text);
        res.json({ ingredients });
    } catch (err) {
        next(err);
    }
});

app.use("/api", (req, res) => {
    res.status(404).json({ error: "Not found." });
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        const message = err.code === "LIMIT_FILE_SIZE"
            ? "That photo is too large. Please use one under 8 MB."
            : "Couldn't read the uploaded photo. Please try again.";
        return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: message });
    }
    if (err instanceof ScanError) {
        return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

app.listen(PORT, () => {
    console.log(`Cooking scanner running at http://localhost:${PORT}`);
    if (!ai) console.warn("Warning: GEMINI_API_KEY is not set in .env, so scanning will fail.");
});
