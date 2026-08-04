<script setup lang="ts">
import { useAppContext } from "../app-context";
import HomeworkBoard from "./HomeworkBoard.vue";

const { appData, homeworkGroups, isMobileRuntime, isHomeworkFrozen, openEditHomework, requestDeleteHomework } = useAppContext();
</script>

<template>
  <HomeworkBoard
    :mobile-layout="isMobileRuntime"
    :groups="homeworkGroups"
    :max-panel-width="appData.settings.maxPanelWidth"
    :readonly="isHomeworkFrozen"
    @edit="openEditHomework"
    @delete="requestDeleteHomework"
  />
</template>
