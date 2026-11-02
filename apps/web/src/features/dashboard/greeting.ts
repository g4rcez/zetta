/** "Good morning" / "Good afternoon" / "Good evening" for a local hour (0-23). */
export function greeting(hour: number) {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
