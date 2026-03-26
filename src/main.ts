import "./style.css";
import { PowerRoundApp } from "./game/app";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root was not found.");
}

new PowerRoundApp(root);
