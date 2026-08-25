"use client";

import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { FoodDatabaseItem } from "@/lib/nutrition-data";

export function FoodQuickFillPicker({
  foods,
}: Readonly<{ foods: readonly FoodDatabaseItem[] }>) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const filteredFoods = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (normalizedQuery.length === 0) {
      return foods;
    }

    return foods.filter((food) =>
      `${food.name} ${food.unit}`.toLowerCase().includes(normalizedQuery),
    );
  }, [foods, query]);
  const selectedFoods = foods.filter((food) => selected.has(food.id));

  if (foods.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-2 rounded-md border border-border bg-secondary p-3">
      <label className="grid gap-1 text-xs font-semibold text-muted-foreground">
        Quick fill ingredients
        <span className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search previous foods"
            type="search"
            value={query}
          />
        </span>
      </label>

      <div className="grid max-h-52 gap-2 overflow-auto pr-1 sm:grid-cols-2">
        {filteredFoods.map((food) => (
          <label
            className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-border bg-card p-2 text-xs"
            key={food.id}
          >
            <input
              checked={selected.has(food.id)}
              className="mt-0.5 size-4 accent-[var(--primary)]"
              onChange={() => {
                setSelected((current) => toggle(current, food.id));
              }}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block truncate font-semibold text-foreground">
                {food.name}
              </span>
              <span className="block font-mono text-muted-foreground">
                {food.quantity} {food.unit} · {food.totals.calories} kcal · P{" "}
                {food.totals.proteinGrams}
              </span>
            </span>
          </label>
        ))}
      </div>

      {selectedFoods.map((food) => (
        <input
          key={food.id}
          name="quick_food"
          type="hidden"
          value={JSON.stringify(food)}
        />
      ))}

      <Badge className="w-fit" variant="secondary">
        <Plus className="mr-1 size-4 text-primary" aria-hidden="true" />
        {selectedFoods.length} selected
      </Badge>
    </div>
  );
}

function toggle(current: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(current);

  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }

  return next;
}
