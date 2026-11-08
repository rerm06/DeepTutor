import type { Location } from "../api/types";
import type { BrandOption } from "../components/ConsentPanel";

/**
 * The contract has no brands endpoint: a brand is known through its locations. Returns the brands of
 * the given home locations, labelled with the names of every visible location of that brand.
 */
export function brandsFor(
  locations: Location[],
  homeLocationIds: string[],
  label: (locationNames: string) => string,
): BrandOption[] {
  const ids: string[] = [];
  for (const home of homeLocationIds) {
    const brand = locations.find((l) => l.id === home)?.brand_id;
    if (brand && !ids.includes(brand)) ids.push(brand);
  }
  return ids.map((id) => ({
    id,
    label: label(
      locations
        .filter((l) => l.brand_id === id)
        .map((l) => l.name)
        .join(", "),
    ),
  }));
}
