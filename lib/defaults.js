export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export function defaultMenu() {
  return [
    {
      id: uid(),
      name: "Surti Aloopuri",
      items: [
        { id: uid(), name: "Red Sev", variants: [{ id: uid(), label: "Regular", price: 9.0 }, { id: uid(), label: "Crunchy", price: 9.49 }] },
        { id: uid(), name: "Papdi", variants: [{ id: uid(), label: "Regular", price: 10.0 }, { id: uid(), label: "Crunchy", price: 10.49 }] },
        { id: uid(), name: "Cheese", variants: [{ id: uid(), label: "Regular", price: 11.0 }, { id: uid(), label: "Crunchy", price: 11.49 }] },
        { id: uid(), name: "Yellow Sev", variants: [{ id: uid(), label: "Regular", price: 9.0 }, { id: uid(), label: "Crunchy", price: 9.49 }] },
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
