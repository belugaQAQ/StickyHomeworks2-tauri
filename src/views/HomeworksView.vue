<script setup lang="ts">
import { useAppContext } from "../app-context";
import HomeworkBoard from "./HomeworkBoard.vue";

const { appData, homeworkGroups, isMobileRuntime, openEditHomework, requestDeleteHomework } = useAppContext();
</script>

<template>
  <HomeworkBoard
    :mobile-layout="isMobileRuntime"
    :groups="homeworkGroups"
    :max-panel-width="appData.settings.maxPanelWidth"
    @edit="openEditHomework"
    @delete="requestDeleteHomework"
  />
</template>
