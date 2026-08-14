export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Everything is a simple, independently-orderable item -- base plates and
// every add-on/topping alike -- each with its own quantity in the cart,
// Uber-Eats style. No nested pickers: "11 Cheese Aloopuri, 5 with Papdi,
// 4 with extra Red Sev" is just four separate line items in one order.
export function defaultMenu() {
  return [
    {
      id: uid(),
      name: "Surti Aloopuri",
      items: [
        { id: uid(), name: "Surti Aloopuri", variants: [{ id: uid(), label: "Regular", price: 9.0 }, { id: uid(), label: "Crunchy", price: 9.5 }] },
        { id: uid(), name: "Extra Red Sev", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Yellow Sev", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Cheese", variants: [{ id: uid(), label: "", price: 2.0 }] },
        { id: uid(), name: "Papdi", variants: [{ id: uid(), label: "", price: 1.0 }] },
      ],
    },
    {
      id: uid(),
      name: "Coco",
      items: [
        {
          id: uid(),
          name: "Coco",
          // One combined tap for a pre-flavored coco: size + flavor +
          // price all in a single Style pick. Add more flavor/size rows
          // here any time from Setup -- no code change needed.
          variants: [
            { id: uid(), label: "12 oz", price: 8.0 },
            { id: uid(), label: "1 Liter", price: 20.0 },
            { id: uid(), label: "Kaju 12 oz", price: 9.0 },
            { id: uid(), label: "Kaju 1 Liter", price: 21.0 },
            { id: uid(), label: "Choco Chip 12 oz", price: 9.0 },
            { id: uid(), label: "Choco Chip 1 Liter", price: 21.0 },
            { id: uid(), label: "Ice Cream 12 oz", price: 10.0 },
            { id: uid(), label: "Ice Cream 1 Liter", price: 23.0 },
          ],
        },
        // Stackable extras -- their own item, own quantity, addable to any
        // order alongside a Coco (or on their own), same pattern as the
        // Surti Aloopuri add-ons above.
        { id: uid(), name: "Extra Kaju", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Choco Chip", variants: [{ id: uid(), label: "", price: 1.0 }] },
        { id: uid(), name: "Extra Ice Cream", variants: [{ id: uid(), label: "", price: 2.0 }] },
      ],
    },
  ];
}

export function defaultPartners() {
  return Array.from({ length: 5 }, (_, i) => ({ id: uid(), name: "Partner " + (i + 1) }));
}

// Older versions of this app stored menu items with a nested
// addOnMode/sizeFlavorMode picker config instead of a flat `variants`
// array. The rest of the app assumes every item has a non-empty
// item.variants array (e.g. item.variants.length, item.variants.find(...))
// -- if a leftover old-format item without one ever reaches those places,
// it throws and takes down the whole page (both the staff app and the
// public /order page, since both read the menu through getOrInitMenu).
//
// This runs on every menu read and repairs anything that doesn't already
// look like the current clean shape, so nothing downstream ever has to
// special-case it again. A repaired item gets a single placeholder
// "$0.00" variant -- it shows up in Setup looking obviously wrong (instead
// of crashing), so staff can fix the price or delete it. It is NOT
// written back to the database automatically; the underlying row is only
// changed when staff edits/saves that item (or resets the whole menu).
export function normalizeMenu(menu) {
  if (!Array.isArray(menu)) return [];
  return menu
    .filter((g) => g && typeof g === "object")
    .map((g) => ({
      id: g.id || uid(),
      name: typeof g.name === "string" && g.name.trim() ? g.name : "Untitled",
      items: Array.isArray(g.items) ? g.items.filter((i) => i && typeof i === "object").map(normalizeItem) : [],
    }));
}

function normalizeItem(item) {
  const rawVariants = Array.isArray(item.variants) ? item.variants : [];
  const variants = rawVariants
    .filter((v) => v && typeof v === "object" && Number(v.price) > 0)
    .map((v) => ({ id: v.id || uid(), label: typeof v.label === "string" ? v.label : "", price: Number(v.price) }));
  if (variants.length === 0) {
    // No usable variants survived -- this is the old-format case (or any
    // other malformed item). Fall back to a legacy `price` field if one
    // happens to exist, otherwise $0.00, so the item is still visible and
    // editable rather than silently dropped or crash-inducing.
    variants.push({ id: uid(), label: "", price: Number(item.price) || 0 });
  }
  return {
    id: item.id || uid(),
    name: typeof item.name === "string" && item.name.trim() ? item.name : "Unnamed item",
    variants,
  };
}
