# Cooking-scanner
A tool that scans your ingredients and generates recipe suggestions based on what you have. It filters recipes by your selected timeframe and number of servings, helping you quickly find meals you can make with minimal effort.

## Running it locally

1. Install [Node.js](https://nodejs.org) 20 or newer.
2. In the project folder, run `npm install`.
3. Copy `.env.example` to `.env` (it's gitignored, never commit it) and fill in your Gemini and Spoonacular keys.
   `MEALDB_API_KEY=1` is TheMealDB's free test key and can stay as is.
4. Run `npm start` and open http://localhost:3000.

## Recipe API (for the front end)

`POST /api/recipes` with a JSON body:

```json
{ "ingredients": ["chicken breast", "lemon"], "maxMinutes": 30, "servings": 2, "culture": "Moroccan" }
```

Everything is optional. `ingredients` can also be the objects `/api/scan` returns (with `name` and `category`).
`culture` is a country or cuisine like `Moroccan`, `Kenya` or `West Africa`.

It returns `{ "recipes": [...], "sources": { "local": 3, "themealdb": 4 } }` (`themealdb` is `"unavailable"` if TheMealDB was down).
Recipes come from `data/african_recipes.json` and [TheMealDB](https://www.themealdb.com), all in the same format as `african_recipes.json`, plus:

- `image`: **new**, a photo URL for TheMealDB recipes. It's `null` for our own recipes, so show a placeholder.
- `estimated`: which of `time_minutes` / `servings` were guessed by Gemini (TheMealDB doesn't provide them). Show these as "about 45 min". `time_minutes` and `servings` can also be `null` when unknown.
- `matched_ingredients`: which of the user's ingredients the recipe uses.
- `scale`: multiply amounts by this to get the requested servings (`null` if unknown).
- `story` and `safety` are `null` for TheMealDB recipes.
