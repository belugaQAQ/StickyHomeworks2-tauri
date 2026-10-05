<script setup lang="ts">
import { useAppContext } from "../app-context";
import HomeworkBoard from "./HomeworkBoard.vue";

const { appData, homeworkGroups, isMobileLayout, isHomeworkFrozen, openEditHomework, requestDeleteHomework } = useAppContext();
</script>

<template>
  <HomeworkBoard
    :mobile-layout="isMobileLayout"
    :groups="homeworkGroups"
    :max-panel-width="appData.settings.maxPanelWidth"
    :homework-scale="appData.settings.homeworkScale"
    :readonly="isHomeworkFrozen"
    @edit="openEditHomework"
    @delete="requestDeleteHomework"
  />
</template>
