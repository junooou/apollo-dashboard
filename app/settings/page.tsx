import { redirect } from "next/navigation";

/** Settings was renamed to Filters. Keep the old path working for bookmarks. */
export default function SettingsRedirect() {
  redirect("/filters");
}
