"use client";

import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type MealSlotEditorSlot = Readonly<{
  name: string;
  timeMinutes: number;
  remindersEnabled: boolean;
}>;

export function MealSlotEditor({
  initialSlots,
}: Readonly<{
  initialSlots: readonly MealSlotEditorSlot[];
}>) {
  const seededSlots = useMemo(
    () =>
      initialSlots.length === 0
        ? [
            {
              name: "Breakfast",
              timeMinutes: 540,
              remindersEnabled: true,
            },
            {
              name: "Lunch",
              timeMinutes: 780,
              remindersEnabled: true,
            },
            {
              name: "Dinner",
              timeMinutes: 1_200,
              remindersEnabled: true,
            },
          ]
        : initialSlots,
    [initialSlots],
  );
  const [slots, setSlots] = useState(
    seededSlots.map((slot, index) => ({
      ...slot,
      key: `${index}-${slot.name}-${slot.timeMinutes}`,
    })),
  );

  function updateSlot(
    key: string,
    patch: Partial<Omit<(typeof slots)[number], "key">>,
  ) {
    setSlots((current) =>
      current.map((slot) => (slot.key === key ? { ...slot, ...patch } : slot)),
    );
  }

  function addSlot() {
    setSlots((current) => {
      const lastTime = current.at(-1)?.timeMinutes ?? 12 * 60;

      return [
        ...current,
        {
          key: crypto.randomUUID(),
          name: `Meal ${current.length + 1}`,
          timeMinutes: Math.min(lastTime + 180, 23 * 60),
          remindersEnabled: true,
        },
      ];
    });
  }

  function deleteSlot(key: string) {
    setSlots((current) =>
      current.length <= 1
        ? current
        : current.filter((slot) => slot.key !== key),
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-border bg-secondary p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase text-muted-foreground">
            Meal slots
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Add the meals you actually use. Plans and meal logging use these
            names.
          </p>
        </div>
        <Button onClick={addSlot} size="sm" type="button" variant="outline">
          <Plus className="size-4" aria-hidden="true" />
          Add slot
        </Button>
      </div>

      <div className="grid gap-3">
        {slots.map((slot, index) => (
          <div
            className="grid gap-2 rounded-md border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto_auto] sm:items-end"
            key={slot.key}
          >
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
              Slot {index + 1}
              <Input
                name="meal_slot_name"
                onChange={(event) =>
                  updateSlot(slot.key, { name: event.target.value })
                }
                value={slot.name}
              />
            </label>
            <label className="grid min-w-0 gap-1 text-xs font-semibold text-muted-foreground">
              Time
              <Input
                name="meal_slot_time"
                onChange={(event) =>
                  updateSlot(slot.key, {
                    timeMinutes: timeToMinutes(event.target.value),
                  })
                }
                type="time"
                value={minutesToTime(slot.timeMinutes)}
              />
            </label>
            <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-secondary px-3 py-2 text-xs font-semibold text-muted-foreground">
              <input
                name="meal_slot_reminders_enabled"
                type="hidden"
                value={slot.remindersEnabled ? "yes" : "no"}
              />
              <input
                checked={slot.remindersEnabled}
                className="size-4 accent-[var(--primary)]"
                onChange={(event) =>
                  updateSlot(slot.key, {
                    remindersEnabled: event.target.checked,
                  })
                }
                type="checkbox"
                value="yes"
              />
              Reminder
            </label>
            <Button
              aria-label={`Remove ${slot.name || `slot ${index + 1}`}`}
              className="h-10 w-10 p-0"
              disabled={slots.length <= 1}
              onClick={() => deleteSlot(slot.key)}
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function minutesToTime(minutes: number): string {
  const clamped = Math.min(Math.max(Math.round(minutes), 0), 1_439);
  const hour = Math.floor(clamped / 60);
  const minute = clamped % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return 12 * 60;
  }

  return Math.min(Math.max((hour ?? 12) * 60 + (minute ?? 0), 0), 1_439);
}
