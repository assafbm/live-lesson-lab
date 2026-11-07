import { test, expect } from "@playwright/test";
import WebSocket from "ws";

async function client() {
  const socket = new WebSocket("ws://127.0.0.1:4301/signal");
  const messages: any[] = [];
  socket.on("message", (data) => messages.push(JSON.parse(data.toString())));
  await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
  return {
    socket, messages,
    send: (message: object) => socket.send(JSON.stringify(message)),
    async receive(type: string) {
      await expect.poll(() => messages.findIndex((message) => message.type === type)).toBeGreaterThanOrEqual(0);
      return messages.splice(messages.findIndex((message) => message.type === type), 1)[0];
    }
  };
}

test("signaling enforces room isolation, two participants and role permissions", async () => {
  const teacher = await client();
  const student = await client();
  const stranger = await client();
  try {
    teacher.send({ type: "create-room" });
    const { roomId } = await teacher.receive("room-created");
    teacher.send({ type: "enter-room", roomId });
    await teacher.receive("room-entered");
    student.send({ type: "join-room", roomId });
    await student.receive("room-joined");
    await teacher.receive("peer-joined");
    stranger.send({ type: "join-room", roomId });
    expect((await stranger.receive("room-error")).message).toContain("already has a student");
    stranger.send({ type: "offer", roomId, sdp: "untrusted" });
    expect((await stranger.receive("room-error")).message).toContain("Join a lesson");
    student.send({ type: "offer", roomId, sdp: "untrusted" });
    expect((await student.receive("room-error")).message).toContain("Only the teacher");
    student.send({ type: "audio-state", roomId: "different-room", enabled: true });
    expect((await student.receive("room-error")).message).toContain("Join a lesson");
    student.send({ type: "audio-state", roomId, enabled: true });
    expect((await teacher.receive("audio-state")).enabled).toBe(true);
    student.send({ type: "exit-room", roomId });
    await student.receive("room-exited");
    await teacher.receive("peer-left");
    student.send({ type: "enter-room", roomId });
    await student.receive("room-entered");
    await teacher.receive("peer-joined");
    teacher.socket.close();
    expect((await student.receive("room-closed")).roomId).toBe(roomId);
  } finally { teacher.socket.close(); student.socket.close(); stranger.socket.close(); }
});

test("only the teacher can gate new memberships, while admitted participants can return", async () => {
  const teacher = await client();
  const student = await client();
  try {
    teacher.send({ type: "create-room" });
    const { roomId } = await teacher.receive("room-created");
    const original = await teacher.receive("room-access");
    expect(original.locked).toBe(false);
    expect(original.joinExpiresAt).toBeGreaterThan(Date.now());
    student.send({ type: "end-room", roomId });
    expect((await student.receive("room-error")).message).toContain("Only the room's teacher");
    teacher.send({ type: "set-room-locked", roomId, locked: true });
    expect((await teacher.receive("room-access")).locked).toBe(true);
    student.send({ type: "join-room", roomId });
    expect((await student.receive("room-error")).message).toContain("locked or expired");
    teacher.send({ type: "renew-invitation", roomId });
    const renewed = await teacher.receive("room-access");
    expect(renewed.locked).toBe(true);
    expect(renewed.joinExpiresAt).toBeGreaterThanOrEqual(original.joinExpiresAt);
    teacher.send({ type: "set-room-locked", roomId, locked: false });
    await teacher.receive("room-access");
    student.send({ type: "join-room", roomId });
    await student.receive("room-joined");
    student.send({ type: "set-room-locked", roomId, locked: false });
    expect((await student.receive("room-error")).message).toContain("Only the room's teacher");
    teacher.send({ type: "set-room-locked", roomId, locked: true });
    await teacher.receive("room-access");
    student.send({ type: "exit-room", roomId });
    await student.receive("room-exited");
    student.send({ type: "enter-room", roomId });
    await student.receive("room-entered");
    teacher.send({ type: "end-room", roomId });
    expect((await student.receive("room-closed")).reason).toContain("ended");
    expect((await teacher.receive("room-closed")).roomId).toBe(roomId);
    student.send({ type: "join-room", roomId });
    expect((await student.receive("room-error")).message).toContain("ended");
  } finally { teacher.socket.close(); student.socket.close(); }
});

test("lesson clock starts on teacher entry and extensions are teacher-only and idempotent", async () => {
  const teacher = await client();
  const student = await client();
  try {
    teacher.send({ type: "create-room", durationMinutes: 90 });
    const { roomId } = await teacher.receive("room-created");
    expect(await teacher.receive("lesson-time")).toMatchObject({ durationMinutes: 90, endsAt: null });
    await teacher.receive("room-access");
    teacher.send({ type: "enter-room", roomId });
    await teacher.receive("room-entered");
    const started = await teacher.receive("lesson-time");
    expect(started.endsAt - started.serverNow).toBeGreaterThan(89 * 60000);
    student.send({ type: "join-room", roomId });
    await student.receive("room-joined");
    expect((await student.receive("lesson-time")).endsAt).toBe(started.endsAt);
    student.send({ type: "extend-lesson", roomId, expectedEndsAt: started.endsAt });
    expect((await student.receive("room-error")).message).toContain("Only the room's teacher");
    teacher.send({ type: "extend-lesson", roomId, expectedEndsAt: started.endsAt });
    const extended = await teacher.receive("lesson-time");
    expect(extended.durationMinutes).toBe(105);
    expect(extended.endsAt).toBe(started.endsAt + 15 * 60000);
    teacher.send({ type: "extend-lesson", roomId, expectedEndsAt: started.endsAt });
    expect((await teacher.receive("lesson-time")).endsAt).toBe(extended.endsAt);
    teacher.send({ type: "exit-room", roomId });
    await teacher.receive("room-exited");
    teacher.send({ type: "enter-room", roomId });
    await teacher.receive("room-entered");
    expect((await teacher.receive("lesson-time")).endsAt).toBe(extended.endsAt);
  } finally { teacher.socket.close(); student.socket.close(); }
});
