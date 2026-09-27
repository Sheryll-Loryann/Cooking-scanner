import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const LOCAL_RECIPES = JSON.parse(
    readFileSync(path.join(__dirname, "data", "african_recipes.json"), "utf8")
).map((recipe) => ({ ...recipe, image: null, estimated: [] }));

const MEALDB_KEY = process.env.MEALDB_API_KEY || "1";
const MEALDB_BASE = `https://www.themealdb.com/api/json/v1/${MEALDB_KEY}/`;
const MEALDB_TIMEOUT_MS = 4000;
const GEMINI_TIMEOUT_MS = 8000;
const MAX_SEARCH_INGREDIENTS = 5;
const MAX_MEALDB_LOOKUPS = 4;
const MAX_RESULTS = 12;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// Things nearly every recipe uses; they shouldn't drive the search or the score.
const STAPLES = new Set([
    "salt", "pepper", "black pepper", "oil", "olive oil", "vegetable oil", "water", "sugar",
    "flour", "butter", "stock", "spice", "spices", "cumin", "paprika", "turmeric", "cinnamon",
    "curry powder", "chili powder", "garlic powder", "ginger powder", "bay leaf", "thyme",
    "oregano", "nutmeg", "clove", "coriander", "garam masala", "baking powder", "baking soda",
    "vinegar", "soy sauce", "ice", "iced tea", "orange juice", "juice", "soda",
]);

// When the scan gives categories, search the "main" ingredients first.
const CATEGORY_PRIORITY = { protein: 0, produce: 1, grain: 2, dairy: 3, other: 4, condiment: 5, drink: 6 };

// ---------- Small helpers ----------

const cache = new Map();

async function cached(key, load) {
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;

    const value = await load();
    if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
}

function normalizeName(name) {
    return String(name || "")
        .toLowerCase()
        .replace(/\(.*?\)/g, " ")
        .replace(/[^a-z\s-]/g, " ")
        .split(/[\s-]+/)
        .filter(Boolean)
        .map((word) => word.replace(/(oes|ies|es|s)$/, (end) => ({ oes: "o", ies: "y", es: "e", s: "" })[end]))
        .join(" ");
}

// Words that describe an ingredient rather than name it ("chopped bell pepper" -> "bell pepper").
const DESCRIPTORS = /\b(red|green|yellow|orange|white|purple|chopped|shredded|sliced|diced|minced|fresh|frozen|dried|pickled|canned|cooked|raw|whole|large|small|baby)\s+(?=\S)/g;

function stripDescriptors(name) {
    return name.replace(DESCRIPTORS, "").trim() || name;
}

function containsWords(haystack, needle) {
    return ` ${haystack} `.includes(` ${needle} `);
}

// "egg" matches "eggs", "chicken" matches "chicken thighs", "chicken breast" matches "chicken",
// but "sweet potato" doesn't match "potato" and "bell pepper" doesn't match the spice "pepper".
function ingredientMatches(userKey, recipeName) {
    if (containsWords(recipeName, userKey)) return true;
    return !isStaple(recipeName) && userKey.startsWith(`${recipeName} `);
}

function isStaple(name) {
    // "chicken stock" or "beef bouillon cube" shouldn't count as having chicken or beef.
    return STAPLES.has(name) || STAPLES.has(normalizeName(name)) ||
        /\b(stock|broth|bouillon|cube|powder|seasoning|extract)$/.test(normalizeName(name));
}

// "Moroccan" should match "Morocco", "Kenyan" should match "Kenya / Tanzania / Uganda".
function matchesCulture(recipe, culture) {
    const wanted = culture.toLowerCase().trim();
    const stem = wanted.slice(0, Math.max(4, wanted.length - 3));
    const places = [recipe.country, recipe.region].filter(Boolean).join(" / ").toLowerCase();
    return places.includes(wanted) || places.split(/\s*\/\s*/).some((place) => place.startsWith(stem));
}

function sameDish(titleA, titleB) {
    const a = normalizeName(titleA).replace(/\b(home made|homemade|easy|classic|traditional)\b/g, "").trim();
    const b = normalizeName(titleB).replace(/\b(home made|homemade|easy|classic|traditional)\b/g, "").trim();
    return a === b || containsWords(a, b) || containsWords(b, a);
}

// ---------- Local recipes ----------

function scoreRecipe(recipe, userIngredients) {
    const recipeNames = recipe.ingredients.map((item) => normalizeName(item.name)).filter((name) => !isStaple(name));
    const matched = userIngredients.filter((user) =>
        recipeNames.some((recipeName) => ingredientMatches(user.key, recipeName))
    );
    return { score: matched.length, matched: matched.map((user) => user.name) };
}

// ---------- TheMealDB ----------

async function mealDbGet(endpoint) {
    return cached(`mealdb:${endpoint}`, async () => {
        const response = await fetch(MEALDB_BASE + endpoint, { signal: AbortSignal.timeout(MEALDB_TIMEOUT_MS) });
        if (!response.ok) throw new Error(`TheMealDB ${endpoint} responded ${response.status}`);
        const data = await response.json();
        return data.meals || [];
    });
}

function splitInstructions(text) {
    const lines = String(text || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*(step\s*\d+[:.)]?|\d+[.)])\s*/i, "").trim())
        .filter((line) => line.length > 2);

    // Some meals are one long paragraph; break those into sentences instead.
    if (lines.length === 1) {
        return lines[0].split(/(?<=[.!?])\s+(?=[A-Z])/).map((line) => line.trim()).filter(Boolean);
    }
    return lines;
}

function toCommonFormat(meal) {
    const ingredients = [];
    for (let i = 1; i <= 20; i++) {
        const name = (meal[`strIngredient${i}`] || "").trim();
        if (!name) continue;
        ingredients.push({ name: name.toLowerCase(), amount: (meal[`strMeasure${i}`] || "").trim() || "to taste" });
    }

    const category = (meal.strCategory || "").toLowerCase();
    const place = meal.strArea || meal.strCountry || null;
    const source = meal.strSource && meal.strSource.trim()
        ? `TheMealDB (${meal.strSource.trim()})`
        : "TheMealDB";

    return {
        id: `mealdb-${meal.idMeal}`,
        title: meal.strMeal,
        country: meal.strCountry || meal.strArea || null,
        region: place,
        category: category === "dessert" ? "dessert" : ["side", "starter"].includes(category) ? "side" : "main",
        time_minutes: null,
        advance_prep: null,
        servings: null,
        diet: category === "vegan" ? ["vegan"] : category === "vegetarian" ? ["vegetarian"] : [],
        ingredients,
        steps: splitInstructions(meal.strInstructions),
        story: null,
        safety: null,
        source,
        image: meal.strMealThumb || null,
        estimated: [],
    };
}

// After Gemini says we're over quota (free tier: 5 requests/min), stop estimating for a
// while so we don't burn the quota the photo scan also needs.
let estimatesPausedUntil = 0;

function retryDelayMs(err) {
    const match = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(err.message || "");
    return match ? Number(match[1]) * 1000 : 60 * 1000;
}

// TheMealDB has no time or servings, so ask Gemini for a quick estimate (cached per meal).
async function estimateTimeAndServings(recipe, gemini) {
    if (!gemini.ai || Date.now() < estimatesPausedUntil) return { time_minutes: null, servings: null };

    return cached(`estimate:${recipe.id}`, async () => {
        const prompt = `Estimate the total time in minutes (prep + cooking) and the number of servings for this recipe. Return ONLY JSON like {"time_minutes": 45, "servings": 4}.

Title: ${recipe.title}
Ingredients: ${recipe.ingredients.map((item) => `${item.amount} ${item.name}`).join(", ")}
Instructions: ${recipe.steps.join(" ").slice(0, 2000)}`;

        const request = () => gemini.ai.models.generateContent({
            model: gemini.model,
            contents: prompt,
            config: { responseMimeType: "application/json", abortSignal: AbortSignal.timeout(GEMINI_TIMEOUT_MS) },
        });
        // Retry once if Gemini is briefly overloaded (503).
        const response = await request().catch((err) => {
            if (err.status !== 503) throw err;
            return new Promise((resolve) => setTimeout(resolve, 600)).then(request);
        });
        const data = JSON.parse((response.text || "").replace(/```(?:json)?/gi, "").trim());
        const time = Math.round(Number(data.time_minutes));
        const servings = Math.round(Number(data.servings));
        return {
            time_minutes: time > 0 && time < 24 * 60 ? time : null,
            servings: servings > 0 && servings <= 50 ? servings : null,
        };
    }).catch((err) => {
        if (err.status === 429) {
            estimatesPausedUntil = Date.now() + retryDelayMs(err);
            console.warn(`Gemini quota reached; skipping time/servings estimates for ${Math.round(retryDelayMs(err) / 1000)}s.`);
            return { time_minutes: null, servings: null };
        }
        console.warn(`Couldn't estimate time/servings for "${recipe.title}":`, err.message);
        return { time_minutes: null, servings: null };
    });
}

// Search one ingredient at a time (free tier limit), then rank meals by how many searches they showed up in.
async function findMealDbRecipes(userIngredients, culture, gemini) {
    const searchTerms = userIngredients
        .slice()
        .sort((a, b) => (CATEGORY_PRIORITY[a.category] ?? 4) - (CATEGORY_PRIORITY[b.category] ?? 4))
        .slice(0, MAX_SEARCH_INGREDIENTS);

    const [searches, areaMeals] = await Promise.all([
        Promise.all(searchTerms.map((user) =>
            mealDbGet(`filter.php?i=${encodeURIComponent(user.search.replace(/\s+/g, "_"))}`)
                .then((meals) => ({ user, meals }))
                .catch((err) => ({ user, meals: [], err }))
        )),
        culture ? mealDbGet(`filter.php?a=${encodeURIComponent(culture)}`) : Promise.resolve(null),
    ]);

    // Every single search failing means TheMealDB is down, not that nothing matched.
    if (searches.length && searches.every((search) => search.err)) throw searches[0].err;

    const hits = new Map();
    for (const { user, meals } of searches) {
        for (const meal of meals) {
            const entry = hits.get(meal.idMeal) || { id: meal.idMeal, matched: [] };
            entry.matched.push(user.name);
            hits.set(meal.idMeal, entry);
        }
    }

    let candidates;
    if (areaMeals) {
        // A culture was picked: only keep that area's meals, best ingredient matches first.
        candidates = areaMeals.map((meal) => hits.get(meal.idMeal) || { id: meal.idMeal, matched: [] });
        if (userIngredients.length) candidates = candidates.filter((entry) => entry.matched.length > 0);
    } else {
        candidates = [...hits.values()];
    }
    candidates.sort((a, b) => b.matched.length - a.matched.length);

    const details = await Promise.all(
        candidates.slice(0, MAX_MEALDB_LOOKUPS).map((entry) =>
            mealDbGet(`lookup.php?i=${encodeURIComponent(entry.id)}`)
                .then((meals) => meals[0] ? { meal: meals[0], matched: entry.matched } : null)
                .catch(() => null)
        )
    );

    return Promise.all(
        details.filter(Boolean).map(async ({ meal, matched }) => {
            const recipe = toCommonFormat(meal);
            const estimate = await estimateTimeAndServings(recipe, gemini);
            recipe.time_minutes = estimate.time_minutes;
            recipe.servings = estimate.servings;
            // Only mark what Gemini actually filled in; null means unknown.
            recipe.estimated = ["time_minutes", "servings"].filter((field) => recipe[field] != null);
            return { recipe, score: matched.length, matched };
        })
    );
}

// ---------- Public entry point ----------

/**
 * @param {object} query
 * @param {Array<string|{name: string, category?: string}>} query.ingredients
 * @param {number} [query.maxMinutes]  only recipes that fit in this time
 * @param {number} [query.servings]    used to add a scale factor to each recipe
 * @param {string} [query.culture]     e.g. "Moroccan", "Kenya", "West Africa"
 * @param {{ai: import("@google/genai").GoogleGenAI | null, model: string}} gemini
 */
export async function findRecipes(query, gemini) {
    const culture = typeof query.culture === "string" ? query.culture.trim() : "";
    const maxMinutes = Number(query.maxMinutes) > 0 ? Number(query.maxMinutes) : null;
    const servings = Number(query.servings) > 0 ? Number(query.servings) : null;

    const seen = new Set();
    const userIngredients = (Array.isArray(query.ingredients) ? query.ingredients : [])
        .map((item) => (typeof item === "string" ? { name: item } : item))
        .filter((item) => item && typeof item.name === "string")
        .map((item) => {
            const name = item.name.trim().toLowerCase();
            return {
                name,
                key: stripDescriptors(normalizeName(name)),
                search: stripDescriptors(name.replace(/[^a-z\s-]/g, " ").replace(/\s+/g, " ").trim()),
                category: item.category,
            };
        })
        .filter((item) => item.key && !isStaple(item.name) && !seen.has(item.key) && seen.add(item.key));

    const local = LOCAL_RECIPES
        .filter((recipe) => !culture || matchesCulture(recipe, culture))
        .map((recipe) => ({ recipe, ...scoreRecipe(recipe, userIngredients) }))
        .filter((result) => !userIngredients.length || result.score > 0);

    let mealDb = [];
    let mealDbStatus = "ok";
    try {
        mealDb = await findMealDbRecipes(userIngredients, culture, gemini);
    } catch (err) {
        // TheMealDB down or slow: carry on with our own recipes.
        console.warn("Skipping TheMealDB:", err.message);
        mealDbStatus = "unavailable";
    }
    mealDb = mealDb.filter(({ recipe }) => !LOCAL_RECIPES.some((own) => sameDish(own.title, recipe.title)));

    const results = [...local, ...mealDb]
        .filter(({ recipe }) => !maxMinutes || recipe.time_minutes == null || recipe.time_minutes <= maxMinutes)
        // Most matched ingredients first; ties go to recipes needing fewer extra ingredients.
        .sort((a, b) => b.score - a.score || a.recipe.ingredients.length - b.recipe.ingredients.length)
        .slice(0, MAX_RESULTS)
        .map(({ recipe, matched }) => ({
            ...recipe,
            matched_ingredients: matched,
            scale: servings && recipe.servings ? Math.round((servings / recipe.servings) * 100) / 100 : null,
        }));

    return {
        recipes: results,
        sources: { local: local.length, themealdb: mealDbStatus === "ok" ? mealDb.length : "unavailable" },
    };
}
