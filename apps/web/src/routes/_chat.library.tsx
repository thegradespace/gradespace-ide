import { createFileRoute } from "@tanstack/react-router";

import { LibraryPage } from "../library/LibraryPage";

export const Route = createFileRoute("/_chat/library")({
  component: LibraryPage,
});
