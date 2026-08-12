import type { ProductRecord } from "./types";

export const PRODUCTS: ProductRecord[] = [
  { productId: "milk-oat", name: "Oat Milk", category: "Dairy alternatives", priceCents: 219, unit: "1 L", imageEmoji: "🥛", description: "Barista-style oat milk for coffee and cereal." },
  { productId: "bread-sourdough", name: "Sourdough Loaf", category: "Bakery", priceCents: 349, unit: "650 g", imageEmoji: "🍞", description: "Slow-fermented loaf baked this morning." },
  { productId: "apples-elstar", name: "Elstar Apples", category: "Fruit", priceCents: 299, unit: "1 kg", imageEmoji: "🍎", description: "Crisp Dutch apples with a sweet-tart bite." },
  { productId: "coffee-beans", name: "House Coffee Beans", category: "Pantry", priceCents: 699, unit: "500 g", imageEmoji: "☕", description: "Medium roast beans from the demo roastery." },
  { productId: "pasta-rigatoni", name: "Rigatoni", category: "Pantry", priceCents: 179, unit: "500 g", imageEmoji: "🍝", description: "Bronze-cut pasta for weeknight sauces." },
  { productId: "tomatoes-vine", name: "Vine Tomatoes", category: "Vegetables", priceCents: 249, unit: "500 g", imageEmoji: "🍅", description: "Juicy tomatoes for salads, toast, and pasta." },
  { productId: "cheese-gouda", name: "Young Gouda", category: "Cheese", priceCents: 389, unit: "300 g", imageEmoji: "🧀", description: "Creamy slices from a Dutch dairy cooperative." },
  { productId: "chocolate-dark", name: "Dark Chocolate", category: "Snacks", priceCents: 229, unit: "100 g", imageEmoji: "🍫", description: "70% cocoa with a clean, simple ingredient list." },
  { productId: "beer-pale-ale", name: "Dutch Pale Ale", category: "Alcohol", priceCents: 249, unit: "330 ml", imageEmoji: "🍺", description: "Demo alcohol item. Checkout requires the active U-net over-18 attestation.", requiresChecks: ["dynamic:age:18"] },
];
