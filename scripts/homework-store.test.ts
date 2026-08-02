import assert from "node:assert/strict";
import test from "node:test";
import { createSerialCommitQueue } from "../src/composables/serialCommitQueue.ts";

test("serializes mutations against the newest committed state", async () => {
  const enqueue = createSerialCommitQueue();
  const settings = { subjects: [] as string[], tags: [] as string[] };

  await Promise.all([
    enqueue(async () => {
      await Promise.resolve();
      settings.subjects.push("数学");
    }),
    enqueue(async () => {
      settings.tags.push("复习");
    }),
  ]);

  assert.deepEqual(settings.subjects, ["数学"]);
  assert.deepEqual(settings.tags, ["复习"]);
});

test("continues processing later mutations after a failed write", async () => {
  const enqueue = createSerialCommitQueue();
  const events: string[] = [];

  const failed = enqueue(async () => {
    events.push("failed");
    throw new Error("disk unavailable");
  });
  const succeeded = enqueue(async () => {
    events.push("saved");
  });

  await assert.rejects(failed, /disk unavailable/);
  await succeeded;
  assert.deepEqual(events, ["failed", "saved"]);
});
