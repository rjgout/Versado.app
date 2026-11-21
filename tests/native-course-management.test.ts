import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gameApiRoute } from "../src/lib/native/gamesRoutes";
import { GAME_HANDLERS } from "../src/lib/native/gamesHandlers.server";

test("cursus toevoegen en verbergen staan als expliciete POST-routes in de spelbrug, met handler", () => {
  for (const action of ["subscribe", "unsubscribe"]) {
    const route = gameApiRoute(`/api/courses/c1/${action}`, "POST");
    assert.ok(route, action);
    assert.equal(route.params.courseId, "c1");
    assert.ok(GAME_HANDLERS[route.id as keyof typeof GAME_HANDLERS]?.POST, action);
    for (const method of ["GET", "PUT", "DELETE"]) assert.equal(gameApiRoute(`/api/courses/c1/${action}`, method), null, `${method} ${action}`);
  }
  for (const bad of ["/api/courses/c1/subscribe?x=1", "/api/courses/c%2F1/subscribe", "/api/courses/../x/subscribe", "/api/courses/c1/delete", "/api/courses/c1"]) assert.equal(gameApiRoute(bad, "POST"), null, bad);
});

test("de eigen volgorde loopt via de bestaande list-order-schrijfroute; uitsluitend games en courses mogen via GET met query", () => {
  assert.ok(gameApiRoute("/api/list-order", "PUT"));
  for(const listKey of ["games","courses"])assert.ok(gameApiRoute(`/api/list-order?listKey=${listKey}`,"GET"));
  assert.equal(gameApiRoute("/api/list-order?listKey=today-continue","GET"),null);
  assert.equal(gameApiRoute("/api/list-order?listKey=courses", "PUT"), null);
});

test("web en native delen één cursusbeheerhook en verbergen verwijdert nooit voortgang", () => {
  const hook = readFileSync("src/components/courses/useCourseManagement.ts", "utf8");
  assert.match(hook, /\/unsubscribe/);
  assert.match(hook, /\/subscribe/);
  assert.match(hook, /saveListOrder\("courses"/);
  assert.doesNotMatch(hook, /DELETE|deleteMany|progress/i);
  assert.match(readFileSync("src/components/CoursesClient.tsx", "utf8"), /useCourseManagement/);
  assert.match(readFileSync("src/components/native/NativeLearningView.tsx", "utf8"), /useCourseManagement/);
});

test("de unsubscribe-route zet alleen subscribed uit (voortgang blijft)", () => {
  const route = readFileSync("src/app/api/courses/[courseId]/unsubscribe/route.ts", "utf8");
  assert.doesNotMatch(route, /\.delete\(|deleteMany/);
});
