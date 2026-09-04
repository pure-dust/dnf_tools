import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router/index.ts";
import './styles/galobal.less'
import './styles/controls.less'

createApp(App).use(router).mount("#app");
