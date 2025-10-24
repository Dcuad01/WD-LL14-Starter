// Small recipe browser using TheMealDB API (free key `1`)

// ---------------- API ----------------
// Helper to fetch JSON and surface HTTP errors
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const API = {
  areas: () =>
    fetchJSON("https://www.themealdb.com/api/json/v1/1/list.php?a=list"),
  categories: () =>
    fetchJSON("https://www.themealdb.com/api/json/v1/1/categories.php"),
  mealsByArea: (a) =>
    fetchJSON(
      `https://www.themealdb.com/api/json/v1/1/filter.php?a=${encodeURIComponent(
        a
      )}`
    ),
  mealsByCategory: (c) =>
    fetchJSON(
      `https://www.themealdb.com/api/json/v1/1/filter.php?c=${encodeURIComponent(
        c
      )}`
    ),
  mealById: (id) =>
    fetchJSON(
      `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(
        id
      )}`
    ),
};

// ------------- DOM refs -------------
const areaSel = document.getElementById("areaSelect");
const categorySel = document.getElementById("categorySelect");
const cardsEl = document.getElementById("cards");
const detailEl = document.getElementById("detail");

// ------------- State helpers -------------
let lastQueryKey = null; // used to avoid duplicate network calls

// ------------- Boot -------------
init();

async function init() {
  // Show loading indicators in selects
  renderLoading(areaSel);
  renderLoading(categorySel);

  // Load both lists in parallel
  try {
    await Promise.all([loadAreas(), loadCategories()]);
  } catch (err) {
    // If loading areas/categories fails, show messages in the grid
    console.error(err);
    cardsEl.innerHTML = `<p class="error">Failed to load controls. Try reloading the page.</p>`;
    return;
  }

  // UX: ensure Category shows "All" (empty value) and select first Area by default
  if (areaSel.options.length) {
    areaSel.selectedIndex = 0;
  }
  if (categorySel.options.length) {
    categorySel.value = ""; // "All"
  }

  // Wire unified updater
  areaSel.addEventListener("change", () =>
    updateResults().catch((e) => console.error(e))
  );
  categorySel.addEventListener("change", () =>
    updateResults().catch((e) => console.error(e))
  );

  // Initial population
  await updateResults();
}

// ------------- Loaders -------------
async function loadAreas() {
  try {
    const data = await API.areas();
    const areas = (data.meals || [])
      .map((m) => m.strArea)
      .filter(Boolean)
      .sort();
    // Build options
    areaSel.innerHTML = areas
      .map((a) => `<option value="${escapeHTML(a)}">${escapeHTML(a)}</option>`)
      .join("");
  } catch (err) {
    console.error(err);
    areaSel.innerHTML = `<option value="">Failed to load</option>`;
    throw err;
  }
}

async function loadCategories() {
  try {
    const data = await API.categories();
    const cats = (data.categories || [])
      .map((c) => c.strCategory)
      .filter(Boolean)
      .sort();
    categorySel.innerHTML = ['<option value="">All</option>']
      .concat(
        cats.map(
          (c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`
        )
      )
      .join("");
  } catch (err) {
    console.error(err);
    categorySel.innerHTML = `<option value="">Failed to load</option>`;
    throw err;
  }
}

// ------------- Unified updater -------------
// Replace "Category overrides Area" with a single function that respects both filters.
async function updateResults() {
  const area = areaSel.value || "";
  const category = categorySel.value || "";

  const queryKey = `${area}|${category}`;
  if (queryKey === lastQueryKey) {
    // No change in selection; avoid duplicate network calls
    return;
  }
  lastQueryKey = queryKey;

  // Show loading skeletons
  cardsEl.innerHTML = skeletonCards(8);
  detailEl.hidden = true;
  detailEl.innerHTML = "";

  try {
    let meals = [];

    if (area && category) {
      // Both selected: fetch both in parallel and intersect by idMeal
      const [resA, resC] = await Promise.allSettled([
        API.mealsByArea(area),
        API.mealsByCategory(category),
      ]);

      if (resA.status === "rejected" || resC.status === "rejected") {
        const err = resA.status === "rejected" ? resA.reason : resC.reason;
        throw err;
      }

      const listA = resA.value.meals || [];
      const listC = resC.value.meals || [];
      meals = intersectMealsById(listA, listC);
      if (!meals.length) {
        cardsEl.innerHTML = `<p>No results for ${escapeHTML(
          area
        )} + ${escapeHTML(category)}.</p>`;
        return;
      }
    } else if (area) {
      // Only area
      const data = await API.mealsByArea(area);
      meals = data.meals || [];
      if (!meals.length) {
        cardsEl.innerHTML = `<p>No results for ${escapeHTML(area)}.</p>`;
        return;
      }
    } else if (category) {
      // Only category
      const data = await API.mealsByCategory(category);
      meals = data.meals || [];
      if (!meals.length) {
        cardsEl.innerHTML = `<p>No results for ${escapeHTML(category)}.</p>`;
        return;
      }
    } else {
      // Neither selected -> instruct user
      cardsEl.innerHTML = `<p>Please select an Area and/or a Category.</p>`;
      return;
    }

    // Render cards
    cardsEl.innerHTML = meals.map(cardHTML).join("");
    cardsEl.querySelectorAll("[data-id]").forEach((el) => {
      el.tabIndex = 0;
      el.addEventListener("click", () => showDetail(el.dataset.id));
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") {
          ev.preventDefault();
          showDetail(el.dataset.id);
        }
      });
    });
  } catch (err) {
    console.error(err);
    cardsEl.innerHTML = `<p class="error">Failed to load recipes. ${escapeHTML(
      err.message || ""
    )}</p>`;
  }
}

// Helper to intersect two arrays of meal objects by idMeal.
// Returns items from the first array that also exist in the second (by idMeal string match).
function intersectMealsById(a = [], b = []) {
  const setB = new Set((b || []).map((x) => String(x.idMeal)));
  return (a || []).filter((x) => setB.has(String(x.idMeal)));
}

// ------------- Grid + Cards helpers -------------
function cardHTML(m) {
  const { idMeal, strMeal, strMealThumb } = m;
  return `
    <article class="card" data-id="${idMeal}" aria-label="${escapeHTML(
    strMeal
  )}">
      <img src="${strMealThumb}" alt="${escapeHTML(strMeal)}">
      <div class="p-2">
        <h3>${escapeHTML(strMeal)}</h3>
      </div>
    </article>
  `;
}

function skeletonCards(n) {
  return Array.from(
    { length: n },
    () =>
      `<article class="card" aria-hidden="true"><div style="width:100%;height:160px;background:#f2f2f2"></div><div class="p-2"><div style="height:18px;background:#eee;width:60%"></div></div></article>`
  ).join("");
}

// ------------- Detail View -------------
async function showDetail(id) {
  // Show loading and ensure visible
  detailEl.hidden = false;
  detailEl.innerHTML = `<p>Loading…</p>`;
  try {
    const data = await API.mealById(id);
    const meal = (data.meals || [])[0];
    if (!meal) {
      detailEl.innerHTML = `<p>Not found.</p>`;
      return;
    }

    // Log full meal object per spec
    console.log("Meal detail", meal);

    // Build ingredients list from strIngredient1..20 and strMeasure1..20
    const ingredients = extractIngredients(meal);

    // Render detail HTML (instructions with line breaks)
    const instructions = (meal.strInstructions || "").trim();
    const instructionsHtml = escapeHTML(instructions).replace(/\n/g, "<br>");

    detailEl.innerHTML = `
      <button id="backBtn">← Back to results</button>
      <h2>${escapeHTML(meal.strMeal)}</h2>
      <p><strong>${escapeHTML(meal.strArea || "")}</strong> · ${escapeHTML(
      meal.strCategory || ""
    )}</p>
      <img src="${meal.strMealThumb}" alt="${escapeHTML(
      meal.strMeal
    )}" style="max-width:480px;width:100%;height:auto">
      <h3>Ingredients</h3>
      <ul>${ingredients.map((li) => `<li>${escapeHTML(li)}</li>`).join("")}</ul>
      <h3>Instructions</h3>
      <p>${instructionsHtml}</p>
    `;

    // Back button hides detail and scrolls back to top of results
    const backBtn = document.getElementById("backBtn");
    if (backBtn) {
      backBtn.addEventListener("click", () => {
        detailEl.hidden = true;
        detailEl.innerHTML = "";
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
  } catch (err) {
    console.error(err);
    detailEl.innerHTML = `<p class="error">Failed to load meal.</p>`;
  }
}

function extractIngredients(meal) {
  const out = [];
  for (let i = 1; i <= 20; i++) {
    const ing = meal[`strIngredient${i}`];
    const meas = meal[`strMeasure${i}`];
    if (ing && ing.trim()) {
      const line = [meas, ing]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      out.push(line);
    }
  }
  return out;
}

// ------------- Utils -------------
function escapeHTML(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ])
  );
}
function renderLoading(sel) {
  sel.innerHTML = "<option>Loading…</option>";
}
