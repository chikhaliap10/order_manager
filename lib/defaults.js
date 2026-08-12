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
        { id: uid(), name: "Coco", variants: [{ id: uid(), label: "12 oz", price: 8.0 }, { id: uid(), label: "1 Liter", price: 20.0 }] },
        { id: uid(), name: "Kaju", variants: [{ id: uid(), label: "12 oz", price: 1.0 }, { id: uid(), label: "1 Liter", price: 3.0 }] },
        { id: uid(), name: "Ice Cream", variants: [{ id: uid(), label: "12 oz", price: 2.0 }, { id: uid(), label: "1 Liter", price: 6.0 }] },
        { id: uid(), name: "Choco Chip", variants: [{ id: uid(), label: "12 oz", price: 1.0 }, { id: uid(), label: "1 Liter", price: 3.0 }] },
      ],
    },
  ];
}

export function defaultPartners() {
  return Array.from({ length: 5 }, (_, i) => ({ id: uid(), name: "Partner " + (i + 1) }));
}
