import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router/index.ts";
import './styles/galobal.less'
import './styles/controls.less'
import './utils/index.ts'

createApp(App).use(router).mount("#app");
