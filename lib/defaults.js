export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

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
      items: [
        (() => {
          const size12 = uid();
          const size1L = uid();
          return {
            id: uid(),
            name: "Coco",
            sizeFlavorMode: true,
            sizes: [
              { id: size12, name: "12 oz", basePrice: 8.0 },
              { id: size1L, name: "1 Liter", basePrice: 20.0 },
            ],
            flavors: [
              { id: uid(), name: "Coco", extraBySize: { [size12]: 0, [size1L]: 0 }, defaultChecked: true },
              { id: uid(), name: "Kaju Coco", extraBySize: { [size12]: 1, [size1L]: 3 }, defaultChecked: false },
              { id: uid(), name: "Chocolate Chips Coco", extraBySize: { [size12]: 1, [size1L]: 3 }, defaultChecked: false },
              { id: uid(), name: "Vanilla Ice Cream Coco", extraBySize: { [size12]: 2, [size1L]: 6 }, defaultChecked: false },
            ],
          };
        })(),
      ],
    },
  ];
}

export function defaultPartners() {
  return Array.from({ length: 5 }, (_, i) => ({ id: uid(), name: "Partner " + (i + 1) }));
}
