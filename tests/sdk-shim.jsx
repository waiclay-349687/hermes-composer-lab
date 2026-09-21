// Use the actual host UI primitives. Only registration, storage and notifications
// are fixture substitutes; no gateway or live session is connected.
export { Button } from "@host/components/ui/button";
export {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@host/components/ui/dialog";
export { Switch } from "@host/components/ui/switch";
export { Input } from "@host/components/ui/input";
export { SegmentedControl } from "@host/components/ui/segmented-control";
export const COMPOSER_AREAS = { actions: "test.actions" };
export const PALETTE_AREA = "test.palette";
export const host = { notify: (n) => window.notifications.push(n) };
