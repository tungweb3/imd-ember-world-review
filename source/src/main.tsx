import React from "react";
import { createRoot } from "react-dom/client";
import App from "./world/WorldApp";

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
