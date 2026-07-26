import React from "react";
import { createRoot } from "react-dom/client";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <main>ระบบการเงินส่วนบุคคลและครอบครัว</main>
  </React.StrictMode>
);
