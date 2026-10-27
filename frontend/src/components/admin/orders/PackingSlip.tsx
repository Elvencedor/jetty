"use client";

import { createPortal } from "react-dom";
import { addressLines } from "@/lib/admin/orders";
import type { AdminOrderDetail } from "@/lib/api/admin-orders";
import { formatDateTime, formatPhone } from "@/lib/format";

/**
 * What goes in the parcel. It lives outside the app (a child of `<body>`) and is invisible until printing, when the
 * rules for `.packing-slip` in globals.css hide everything else. No prices: the box may be opened by someone else.
 */
export function PackingSlip({ detail }: { detail: AdminOrderDetail }) {
  const { order, items } = detail;
  const a = order.deliveryAddressSnapshot;
  return createPortal(
    <section className="packing-slip" aria-hidden="true">
      <h1>Packing slip · #{order.orderNumber}</h1>
      <p>{formatDateTime(order.placedAt ?? order.createdAt)}</p>
      <p><strong>{a.recipientName ?? "Customer"}</strong> · {formatPhone(order.phoneE164)}</p>
      <p>{order.deliveryMethod === "pickup" ? "Collection from the studio" : addressLines(a)}</p>
      <table>
        <thead><tr><th>Item</th><th>SKU</th><th>Qty</th></tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>{i.titleSnapshot}{Object.keys(i.optionsSnapshot).length ? <><br />{Object.entries(i.optionsSnapshot).map(([k, v]) => `${k}: ${v}`).join(" · ")}</> : null}</td>
              <td>{i.skuSnapshot}</td>
              <td>{i.quantity}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>,
    document.body,
  );
}
