import { createApp } from "vue";
import App from "./App.vue";
import "./style.css";
import { applyTheme, loadTheme } from "./theme";
applyTheme(loadTheme());
createApp(App).mount("#app");
