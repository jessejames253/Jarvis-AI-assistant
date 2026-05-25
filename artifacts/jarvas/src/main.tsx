/**
 * main.tsx — Entry point for the Jarvis web app
 *
 * This is the very first file that runs when someone opens the app in a browser.
 * It finds the <div id="root"> element in index.html and "mounts" the React app
 * into it. From this point, React takes over and renders everything you see.
 *
 * You rarely need to edit this file — it just boots the app up.
 */

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css"; // Global styles: theme colors, fonts, animations

createRoot(document.getElementById("root")!).render(<App />);
