<<<<<<< HEAD
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
=======
// ---------- Ingredient scan ----------

const MAX_IMAGE_SIDE = 1024;

const cameraInput = document.getElementById("camera-input");
const uploadInput = document.getElementById("upload-input");
const scanResults = document.getElementById("scan-results");
const scanStatus = document.getElementById("scan-status");
const chipList = document.getElementById("ingredient-chips");
const chipAddButton = document.getElementById("chip-add");

let scannedIngredients = [];
let isScanning = false;

// Shrink the photo so its longest side is ~1024px before uploading (faster, cheaper).
function resizeImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.width, img.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
            canvas.height = Math.round(img.height * scale);
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("resize failed"))),
                "image/jpeg",
                0.85
            );
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("unreadable image"));
        };
        img.src = url;
    });
}

function setStatus(message, state) {
    scanResults.hidden = false;
    scanStatus.textContent = message;
    scanStatus.dataset.state = state || "";
}

async function scanPhoto(file) {
    if (!file || isScanning) return;
    if (!file.type.startsWith("image/")) {
        setStatus("That file isn't an image. Please choose a photo.", "error");
        return;
    }

    isScanning = true;
    scanResults.classList.add("is-loading");
    setStatus("Looking at your ingredients…", "loading");

    try {
        let image;
        try {
            image = await resizeImage(file);
        } catch {
            throw new Error("We couldn't read that photo. Please try a different one.");
        }

        const formData = new FormData();
        formData.append("image", image, "scan.jpg");

        let response;
        try {
            response = await fetch("/api/scan", { method: "POST", body: formData });
        } catch {
            throw new Error("Couldn't reach the server. Is it running?");
        }

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || "The scan didn't work. Please try again.");
        }

        scannedIngredients = data.ingredients || [];
        renderChips();
        setStatus(
            scannedIngredients.length
                ? `Found ${scannedIngredients.length} ingredient${scannedIngredients.length === 1 ? "" : "s"}. Tap one to edit it.`
                : "We didn't spot any ingredients. Try a clearer photo, or add them yourself.",
            "done"
        );
    } catch (err) {
        setStatus(err.message, "error");
    } finally {
        isScanning = false;
        scanResults.classList.remove("is-loading");
        cameraInput.value = "";
        uploadInput.value = "";
    }
}

function renderChips() {
    chipList.replaceChildren(...scannedIngredients.map(createChip));
    chipAddButton.hidden = false;
}

function createChip(ingredient, index) {
    const chip = document.createElement("li");
    chip.className = "ingredient-chip";
    if (ingredient.confidence === "low") {
        chip.classList.add("is-unsure");
        chip.title = "Not sure about this one. Check it!";
    }

    const name = document.createElement("input");
    name.className = "chip-name";
    name.type = "text";
    name.value = ingredient.name;
    name.size = Math.max(ingredient.name.length, 4);
    name.setAttribute("aria-label", "Ingredient name");
    name.addEventListener("input", () => {
        ingredient.name = name.value;
        name.size = Math.max(name.value.length, 4);
    });
    name.addEventListener("change", () => {
        ingredient.name = name.value.trim();
        if (!ingredient.name) removeChip(index);
    });

    const quantity = document.createElement("span");
    quantity.className = "chip-quantity";
    quantity.textContent = ingredient.unit === "whole"
        ? `×${ingredient.quantity}`
        : `${ingredient.quantity} ${ingredient.unit}`;

    const remove = document.createElement("button");
    remove.className = "chip-remove";
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${ingredient.name}`);
    remove.addEventListener("click", () => removeChip(index));

    chip.append(name, quantity, remove);
    return chip;
}

function removeChip(index) {
    scannedIngredients.splice(index, 1);
    renderChips();
}

chipAddButton.addEventListener("click", () => {
    scannedIngredients.push({ name: "", quantity: 1, unit: "whole", category: "other", confidence: "high" });
    renderChips();
    chipList.lastElementChild.querySelector(".chip-name").focus();
});

cameraInput.addEventListener("change", () => scanPhoto(cameraInput.files[0]));
uploadInput.addEventListener("change", () => scanPhoto(uploadInput.files[0]));

// Scanned chips + anything typed in the textarea, for the recipe finder to use.
function getIngredientNames() {
    const typed = document.getElementById("ingredients").value
        .split(",")
        .map((name) => name.trim().toLowerCase())
        .filter(Boolean);
    const scanned = scannedIngredients.map((item) => item.name.trim().toLowerCase()).filter(Boolean);
    return [...new Set([...scanned, ...typed])];
}
>>>>>>> fb39eecc81321a1f42a9ea8b5a49c8228b614212
