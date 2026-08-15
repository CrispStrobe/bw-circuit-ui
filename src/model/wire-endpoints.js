/** Shared endpoint-shape helpers for circuit rendering and migration. */
export function isBoardEndpoint(endpoint) {
  return !!(endpoint && (endpoint.board || endpoint.boardId ||
    (endpoint.hole && !endpoint.part)));
}
