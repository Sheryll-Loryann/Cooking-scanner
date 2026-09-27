# Cooking-scanner
A tool that scans your ingredients and generates recipe suggestions based on what you have. It filters recipes by your selected timeframe and number of servings, helping you quickly find meals you can make with minimal effort.

## Running it locally

1. Install [Node.js](https://nodejs.org) 20 or newer.
2. In the project folder, run `npm install`.
3. Create a `.env` file in the project folder (it's gitignored, never commit it) containing:
   ```
   GEMINI_API_KEY=your-key-here
   ```
4. Run `npm start` and open http://localhost:3000.
