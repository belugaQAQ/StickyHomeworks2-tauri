import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./m3e";
import "./styles/base.css";
import { installGlobalErrorHandlers } from "./services/logging";

installGlobalErrorHandlers();
createApp(App).use(router).mount("#app");
