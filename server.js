import dotenv from "dotenv";
import express from "express";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";
import { findRecipes } from "./recipes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

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

// Same idea for Spoonacular: the key stays server-side, the front end calls /api/spoonacular/*.
const SPOONACULAR_API_KEY = process.env.SPOONACULAR_API_KEY;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new ApiError(400, "That file isn't an image. Please choose a photo."));
        }
    },
});

class ApiError extends Error {
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
        throw new ApiError(502, "The scanner returned an unexpected answer. Please try again.");
    }

    let list;
    try {
        list = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
        throw new ApiError(502, "The scanner returned an unexpected answer. Please try again.");
    }
    if (!Array.isArray(list)) {
        throw new ApiError(502, "The scanner returned an unexpected answer. Please try again.");
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
            throw new ApiError(500, "The server is missing GEMINI_API_KEY. Add it to the .env file and restart.");
        }
        if (!req.file) {
            throw new ApiError(400, "No photo received. Please choose a photo to scan.");
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
            throw new ApiError(502, "We couldn't reach the ingredient scanner. Please try again in a moment.");
        }

        const ingredients = parseIngredientList(response.text);
        res.json({ ingredients });
    } catch (err) {
        next(err);
    }
});

app.post("/api/recipes", express.json({ limit: "50kb" }), async (req, res, next) => {
    try {
        const { ingredients = [], maxMinutes, servings, culture } = req.body || {};
        if (!Array.isArray(ingredients) || ingredients.length > 100) {
            throw new ApiError(400, "ingredients must be a list of ingredient names.");
        }
        if (culture != null && (typeof culture !== "string" || culture.length > 50)) {
            throw new ApiError(400, "culture must be a short text like \"Moroccan\".");
        }

        res.json(await findRecipes({ ingredients, maxMinutes, servings, culture }, { ai, model: GEMINI_MODEL }));
    } catch (err) {
        next(err);
    }
});

app.get("/api/spoonacular/ingredients", async (req, res, next) => {
    try {
        if (!SPOONACULAR_API_KEY) {
            throw new ApiError(500, "The server is missing SPOONACULAR_API_KEY. Add it to the .env file and restart.");
        }
        const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
        if (!query) {
            throw new ApiError(400, "query is required.");
        }

        const url = new URL("https://api.spoonacular.com/food/ingredients/search");
        url.searchParams.set("query", query);
        url.searchParams.set("number", "8");
        url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

        const spoonacularResponse = await fetch(url);
        const data = await spoonacularResponse.json();
        if (!spoonacularResponse.ok) {
            throw new ApiError(spoonacularResponse.status, data.message || "Spoonacular request failed.");
        }
        res.json(data);
    } catch (err) {
        next(err);
    }
});

app.get("/api/spoonacular/recipes", async (req, res, next) => {
    try {
        if (!SPOONACULAR_API_KEY) {
            throw new ApiError(500, "The server is missing SPOONACULAR_API_KEY. Add it to the .env file and restart.");
        }
        const query = typeof req.query.query === "string" ? req.query.query.trim() : "";
        if (!query) {
            throw new ApiError(400, "query is required.");
        }

        const url = new URL("https://api.spoonacular.com/recipes/complexSearch");
        url.searchParams.set("query", query);
        url.searchParams.set("number", "1");
        url.searchParams.set("addRecipeInformation", "true");
        url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

        const spoonacularResponse = await fetch(url);
        const data = await spoonacularResponse.json();
        if (!spoonacularResponse.ok) {
            throw new ApiError(spoonacularResponse.status, data.message || "Spoonacular request failed.");
        }
        res.json(data);
    } catch (err) {
        next(err);
    }
});

app.get("/api/spoonacular/recipes/:id", async (req, res, next) => {
    try {
        if (!SPOONACULAR_API_KEY) {
            throw new ApiError(500, "The server is missing SPOONACULAR_API_KEY. Add it to the .env file and restart.");
        }
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            throw new ApiError(400, "Invalid recipe id.");
        }

        const url = new URL(`https://api.spoonacular.com/recipes/${id}/information`);
        url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

        const spoonacularResponse = await fetch(url);
        const data = await spoonacularResponse.json();
        if (!spoonacularResponse.ok) {
            throw new ApiError(spoonacularResponse.status, data.message || "Spoonacular request failed.");
        }
        res.json(data);
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
    if (err.type === "entity.parse.failed") {
        return res.status(400).json({ error: "The request body isn't valid JSON." });
    }
    if (err instanceof ApiError) {
        return res.status(err.status).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong on our side. Please try again." });
});

app.listen(PORT, () => {
    console.log(`Cooking scanner running at http://localhost:${PORT}`);
    if (!ai) console.warn("Warning: GEMINI_API_KEY is not set in .env, so scanning will fail.");
    if (!SPOONACULAR_API_KEY) console.warn("Warning: SPOONACULAR_API_KEY is not set in .env, so recipe search will fail.");
});
