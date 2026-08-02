import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHomework, removeHomeworkRecord, saveHomeworkRecord, toDateInputValue } from "../src/domain/homework.ts";
import { createDefaultAppData, type HomeworkRecord } from "../src/types/app-data.ts";

function homework(overrides: Partial<HomeworkRecord> = {}): HomeworkRecord {
  return {
    id: "homework-1",
    content: "完成练习",
    subject: "数学",
    dueTime: "2026-08-02T00:00:00",
    tags: [],
    firstExpiredShowTime: null,
    ...overrides,
  };
}

test("normalizes editor input without changing the homework identity", () => {
  const result = normalizeHomework(homework({
    id: "stable-id",
    content: "  完成练习  ",
    subject: "  ",
    dueTime: "2026-08-02",
    tags: ["  复习", "复习", "", "作业  "],
  }));

  assert.deepEqual(result, homework({
    id: "stable-id",
    content: "完成练习",
    subject: "其它",
    dueTime: "2026-08-02T00:00:00",
    tags: ["复习", "作业"],
  }));
});

test("updates an existing homework in place and expands editor vocabularies", () => {
  const data = createDefaultAppData();
  data.homeworks = [homework({ content: "旧内容" })];
  data.settings.subjects = ["语文"];
  data.settings.tags = ["已有"];

  const result = saveHomeworkRecord(data, homework({ content: "新内容", subject: "数学", tags: ["已有", "重点"] }));

  assert.equal(result.homeworks.length, 1);
  assert.equal(result.homeworks[0].content, "新内容");
  assert.deepEqual(result.settings.subjects, ["语文", "数学"]);
  assert.deepEqual(result.settings.tags, ["已有", "重点"]);
});

test("removes only the selected homework and preserves the vocabulary", () => {
  const data = createDefaultAppData();
  data.homeworks = [homework(), homework({ id: "homework-2", subject: "语文" })];
  data.settings.subjects = ["数学", "语文"];

  const result = removeHomeworkRecord(data, "homework-1");

  assert.deepEqual(result.homeworks.map((item) => item.id), ["homework-2"]);
  assert.deepEqual(result.settings.subjects, ["数学", "语文"]);
});

test("extracts a calendar input value from persisted local midnight", () => {
  assert.equal(toDateInputValue("2026-08-02T00:00:00"), "2026-08-02");
});
