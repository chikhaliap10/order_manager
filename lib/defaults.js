export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Aloopuri uses a specific pricing structure: a base price (which already
// includes your choice of one sev type), a "sev options" group where
// picking BOTH sevs together costs a bit extra, and separate flat add-ons
// (Papdi, Cheese) that just add their own price regardless of style.
export function defaultMenu() {
  return [
    {
      id: uid(),
      name: "Surti Aloopuri",
      items: [
        {
          id: uid(),
          name: "Surti Aloopuri",
          addOnMode: true,
          basePriceRegular: 9.0,
          basePriceCrunchy: 9.49,
          sevOptions: [
            { id: uid(), name: "Red Sev", extra: 0, defaultChecked: true },
            { id: uid(), name: "Yellow Sev", extra: 0, defaultChecked: false },
            { id: uid(), name: "Red Sev + Yellow Sev", extra: 0.5, defaultChecked: false },
          ],
          addOns: [
            { id: uid(), name: "Papdi", extra: 1.0 },
            { id: uid(), name: "Cheese", extra: 2.0 },
          ],
        },
      ],
    },
    {
      id: uid(),
      name: "Coco",
      items: [{ id: uid(), name: "Coco", variants: [{ id: uid(), label: "", price: 9.0 }] }],
    },
  ];
}

export function defaultPartners() {
  return Array.from({ length: 5 }, (_, i) => ({ id: uid(), name: "Partner " + (i + 1) }));
}
