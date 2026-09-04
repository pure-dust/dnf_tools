import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";
import Layout from '../layout/index.vue'

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "layout",
    component: Layout,
    redirect: "/home",
    children: [
      {
        path: "/home",
        name: "home",
        component: () => import("../pages/home.vue"),
      },
      {
        path: "/schedule",
        name: "schedule",
        component: () => import("../pages/schedule/index.vue"),
        redirect: "/schedule/create",
        children: [
          {
            path: "members",
            name: "schedule-members",
            component: () => import("../pages/schedule/members.vue"),
          },
          {
            path: "templates",
            name: "schedule-templates",
            component: () => import("../pages/schedule/templates.vue"),
          },
          {
            path: "create",
            name: "schedule-create",
            component: () => import("../pages/schedule/create.vue"),
          },
          {
            path: "history",
            name: "schedule-history",
            component: () => import("../pages/schedule/history.vue"),
          },
          {
            path: "history/:id",
            name: "schedule-detail",
            component: () => import("../pages/schedule/detail.vue"),
          },
        ],
      },
    ]
  }
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})