<script setup lang="ts">
import { useRouter } from "vue-router";

interface FuncCard {
  /** 唯一标识，用于渲染对应图标 */
  key: string;
  name: string;
  desc: string;
  /** 点击后跳转的路由 */
  path: string;
}

/** 功能清单：新增功能时在这里追加一条即可 */
const funcs: FuncCard[] = [
  {
    key: "schedule",
    name: "排班",
    desc: "安排副本与打团的班次计划，统一管理成员与时间",
    path: "/schedule",
  },
];

const router = useRouter();

function openCard(card: FuncCard) {
  router.push(card.path);
}
</script>

<template>
  <div class="home">
    <div class="home__inner">
      <div class="home__head">
        <h2 class="home__title">功能选择</h2>
        <p class="home__desc">当前已上线 {{ funcs.length }} 项功能，点击卡片进入</p>
      </div>

      <div class="func-grid">
        <button
          v-for="func in funcs"
          :key="func.key"
          class="func-card"
          type="button"
          @click="openCard(func)"
        >
          <span class="func-card__icon">
            <!-- 排班 -->
            <svg
              v-if="func.key === 'schedule'"
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </span>
          <span class="func-card__name">{{ func.name }}</span>
          <span class="func-card__desc">{{ func.desc }}</span>
        </button>

        <!-- 占位卡片：新功能开发中 -->
        <div class="func-card func-card--soon" aria-disabled="true">
          <span class="func-card__icon">
            <svg
              viewBox="0 0 24 24"
              width="22"
              height="22"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
            >
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="8" x2="12" y2="16" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </span>
          <span class="func-card__name">更多功能</span>
          <span class="func-card__desc">敬请期待</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="less">
.home {
  min-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 28px;

  .home__inner {
    width: 100%;
    max-width: 820px;
  }

  .home__head {
    margin-bottom: 20px;

    .home__title {
      font-size: 20px;
      font-weight: 600;
      color: var(--app-text);
    }

    .home__desc {
      margin-top: 4px;
      font-size: 13px;
      color: var(--app-text-secondary);
    }
  }

  .func-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }

  .func-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
    padding: 20px;
    border: 1px solid var(--app-border);
    border-radius: 12px;
    background-color: var(--app-surface);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: transform 0.2s ease, border-color 0.2s ease,
      box-shadow 0.2s ease;

    &:hover {
      transform: translateY(-3px);
      border-color: var(--app-primary);
      box-shadow: 0 8px 20px var(--app-shadow);
    }

    &:active {
      transform: translateY(-1px);
    }

    &__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      color: var(--app-primary);
      background-color: color-mix(
        in srgb,
        var(--app-primary) 14%,
        transparent
      );
    }

    &__name {
      font-size: 16px;
      font-weight: 600;
      color: var(--app-text);
    }

    &__desc {
      font-size: 13px;
      line-height: 1.5;
      color: var(--app-text-secondary);
    }

    // 占位卡片：虚线边框、不可点击
    &--soon {
      cursor: default;
      border-style: dashed;
      opacity: 0.85;

      &:hover {
        transform: none;
        border-color: var(--app-border);
        box-shadow: none;
      }

      .func-card__icon {
        color: var(--app-text-secondary);
        background-color: var(--app-border);
      }
    }
  }
}
</style>