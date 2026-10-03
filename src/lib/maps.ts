/**
 * The link "Directions" opens.
 *
 * The owner's own Google Maps link wins when there is one: it is the place as
 * Google knows it, with the name, photos and opening hours a customer expects
 * to land on. Otherwise the pinned coordinates, through Google's documented
 * search URL, which opens the Maps app on a phone that has it and the website
 * on one that does not.
 *
 * Empty when the salon has given neither — the button is then not shown,
 * rather than searching Google for the salon's name and hoping.
 */
export function mapsLink(place: {
  mapsUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string {
  const url = place.mapsUrl?.trim();
  if (url) return url;
  if (place.latitude != null && place.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
  }
  return '';
}
