import { StyleSheet, Text, View } from "react-native";
import { Overline } from "@/components/ui";
import { busiestWindow, type CourtForecast } from "@/lib/forecast";
import { useTheme } from "@/lib/theme";
import { yourWindowHours } from "@/lib/your-window";

// Hours displayed in the mini bar chart (8 AM through 10 PM inclusive).
const START_HOUR = 8;
const END_HOUR = 22;
const MAX_BAR_HEIGHT = 44;
const BAR_WIDTH = 14;
const WINDOW_MARK_HEIGHT = 3;
const WINDOW_MARK_GAP = 3;

function to12(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  return h % 12 === 0 ? 12 : h % 12;
}

function period(hour: number): "AM" | "PM" {
  return (((hour % 24) + 24) % 24) < 12 ? "AM" : "PM";
}

// "5–8 PM" for a busiest window of {start:17,end:19}: the run of hours 17–19
// spans clock times 5 PM through 8 PM, so the end label is end + 1.
function windowLabel(win: { start: number; end: number }): string {
  const endHour = win.end + 1;
  const startP = period(win.start);
  const endP = period(endHour);
  return startP === endP
    ? `${to12(win.start)}–${to12(endHour)} ${endP}`
    : `${to12(win.start)} ${startP}–${to12(endHour)} ${endP}`;
}

// Right-aligned mini bar chart of a court's historical hourly turnout, paired
// with its busiest-window label. Hours inside the player's own availability
// windows (the "your window" lens) get an accent tick under the bar. Without
// history there is nothing meaningful to plot, so the section says so
// honestly — popular times fill in as check-ins accumulate.
export function PopularTimes({
  forecast,
  availability = [],
}: {
  forecast: CourtForecast | undefined;
  availability?: string[];
}) {
  const t = useTheme();
  if (!forecast?.has_history) {
    return (
      <View>
        <Overline>Popular Times</Overline>
        <Text style={[t.type.caption, styles.caption, { color: t.colors.textMuted }]}>
          No turnout history yet — popular times fill in as players check in.
        </Text>
      </View>
    );
  }

  const hours = forecast.hours;
  const peak = Math.max(...hours, 0);
  const win = busiestWindow(hours);
  const mine = yourWindowHours(availability, new Date());

  const bars: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) bars.push(h);
  const anyMine = bars.some((h) => mine.has(h));

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Overline>Popular Times</Overline>
        {win ? (
          <Text style={[t.type.caption, styles.caption, { color: t.colors.textSecondary }]}>
            busiest {windowLabel(win)}
          </Text>
        ) : null}
        {anyMine ? (
          <View style={[styles.legend, { marginTop: t.spacing.sm }]}>
            <View style={[styles.legendMark, { backgroundColor: t.colors.accent }]} />
            <Text style={[t.type.caption, { color: t.colors.textSecondary }]}>
              Your window
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.chart}>
        {bars.map((h) => {
          const value = hours[h] ?? 0;
          const height = peak > 0 ? Math.max(2, (value / peak) * MAX_BAR_HEIGHT) : 2;
          const isPeak = peak > 0 && value === peak;
          const isBusy = peak > 0 && value >= peak * 0.8;
          const color = isPeak
            ? t.colors.accent
            : isBusy
              ? t.colors.accentSoft
              : t.colors.surfaceMuted;
          return (
            <View key={h} style={styles.barCol}>
              <View
                style={{
                  width: BAR_WIDTH,
                  height,
                  borderRadius: 3,
                  backgroundColor: color,
                }}
              />
              <View
                style={[
                  styles.windowMark,
                  { backgroundColor: mine.has(h) ? t.colors.accent : "transparent" },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 12,
  },
  left: {
    flexShrink: 1,
    paddingBottom: 2,
  },
  caption: {
    marginTop: 4,
  },
  legend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendMark: {
    width: 10,
    height: WINDOW_MARK_HEIGHT,
    borderRadius: WINDOW_MARK_HEIGHT / 2,
  },
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: MAX_BAR_HEIGHT + WINDOW_MARK_GAP + WINDOW_MARK_HEIGHT,
  },
  barCol: {
    alignItems: "center",
    gap: WINDOW_MARK_GAP,
  },
  windowMark: {
    width: BAR_WIDTH,
    height: WINDOW_MARK_HEIGHT,
    borderRadius: WINDOW_MARK_HEIGHT / 2,
  },
});
