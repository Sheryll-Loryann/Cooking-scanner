const ingredientsField = document.getElementById("ingredients");
const findButton = document.querySelector(".find-button");
const matchesList = document.getElementById("ingredient-matches");
const recipeImage = document.querySelector(".recipe-image");
const recipeTitle = document.querySelector(".recipe-title");
const recipeDescription = document.querySelector(".recipe-description");
const recipeNameOutput = document.getElementById("recipe-name");
const recipeTimeMeta = document.querySelector(".recipe-meta span");
const recipeButton = document.querySelector(".recipe-button");
const recipeIngredientsList = document.getElementById("recipe-ingredients-list");
const recipeInstructions = document.getElementById("recipe-instructions");

let currentRecipeId = null;

async function searchIngredients(query) {
    const url = new URL("https://api.spoonacular.com/food/ingredients/search");
    url.searchParams.set("query", query);
    url.searchParams.set("number", "8");
    url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Spoonacular request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.results ?? [];
}

async function searchRecipes(query) {
    const url = new URL("https://api.spoonacular.com/recipes/complexSearch");
    url.searchParams.set("query", query);
    url.searchParams.set("number", "1");
    url.searchParams.set("addRecipeInformation", "true");
    url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Spoonacular request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.results ?? [];
}

async function fetchRecipeInformation(id) {
    const url = new URL(`https://api.spoonacular.com/recipes/${id}/information`);
    url.searchParams.set("apiKey", SPOONACULAR_API_KEY);

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Spoonacular request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
}

function renderMatches(results) {
    matchesList.innerHTML = "";

    if (results.length === 0) {
        matchesList.innerHTML = "<li class='ingredient-match-empty'>No matches found.</li>";
        return;
    }

    for (const ingredient of results) {
        const item = document.createElement("li");
        item.className = "ingredient-match";

        const img = document.createElement("img");
        img.src = `https://img.spoonacular.com/ingredients_100x100/${ingredient.image}`;
        img.alt = ingredient.name;
        img.width = 32;
        img.height = 32;

        const label = document.createElement("span");
        label.textContent = ingredient.name;

        item.append(img, label);
        matchesList.append(item);
    }
}

function renderRecipe(recipe) {
    currentRecipeId = recipe?.id ?? null;

    if (!recipe) {
        recipeTitle.textContent = "No recipe found";
        recipeDescription.textContent = "Try different ingredients.";
        return;
    }

    recipeImage.src = recipe.image;
    recipeImage.alt = recipe.title;
    recipeTitle.textContent = recipe.title;
    recipeNameOutput.textContent = recipe.title;

    const summaryText = (recipe.summary ?? "").replace(/<[^>]*>/g, "");
    recipeDescription.textContent = summaryText.slice(0, 160) + (summaryText.length > 160 ? "..." : "");

    if (recipe.readyInMinutes) {
        recipeTimeMeta.textContent = `${recipe.readyInMinutes} min`;
    }

    setListItems(recipeIngredientsList, ["Click “See the full recipe” for details."]);
    setListItems(recipeInstructions, ["Click “See the full recipe” for details."]);
}

function setListItems(listElement, items) {
    listElement.innerHTML = "";
    for (const text of items) {
        const item = document.createElement("li");
        item.textContent = text;
        listElement.append(item);
    }
}

function renderFullRecipe(info) {
    const ingredientNames = (info.extendedIngredients ?? []).map((ingredient) => ingredient.name);
    setListItems(recipeIngredientsList, ingredientNames.length ? ingredientNames : ["No ingredients listed."]);

    const steps = info.analyzedInstructions?.[0]?.steps ?? [];
    if (steps.length) {
        setListItems(recipeInstructions, steps.map((step) => step.step));
    } else {
        const plainInstructions = (info.instructions ?? "").replace(/<[^>]*>/g, "");
        setListItems(recipeInstructions, [plainInstructions || "No instructions available."]);
    }
}

async function handleRecipeButtonClick() {
    if (!currentRecipeId) {
        recipeInstructions.textContent = "Find a recipe first.";
        return;
    }

    const originalLabel = recipeButton.innerHTML;
    recipeButton.disabled = true;
    recipeButton.textContent = "Loading...";

    try {
        const info = await fetchRecipeInformation(currentRecipeId);
        renderFullRecipe(info);
    } catch (error) {
        recipeInstructions.textContent = "Something went wrong, try again.";
        console.error(error);
    } finally {
        recipeButton.disabled = false;
        recipeButton.innerHTML = originalLabel;
    }
}

async function handleFindClick() {
    const query = ingredientsField.value.trim();
    if (!query) {
        matchesList.innerHTML = "<li class='ingredient-match-empty'>Add an ingredient first.</li>";
        return;
    }

    matchesList.innerHTML = "<li class='ingredient-match-empty'>Searching...</li>";

    try {
        const [ingredientResults, recipeResults] = await Promise.all([
            searchIngredients(query),
            searchRecipes(query),
        ]);
        renderMatches(ingredientResults);
        renderRecipe(recipeResults[0]);
    } catch (error) {
        matchesList.innerHTML = "<li class='ingredient-match-empty'>Something went wrong, try again.</li>";
        console.error(error);
    }
}

findButton.addEventListener("click", handleFindClick);
recipeButton.addEventListener("click", handleRecipeButtonClick);

