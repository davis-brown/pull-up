import { StyleSheet, Text, View } from "react-native";
import { Overline } from "@/components/ui";
import { busiestWindow, type CourtForecast } from "@/lib/forecast";
import { useTheme } from "@/lib/theme";

// Hours displayed in the mini bar chart (8 AM through 10 PM inclusive).
const START_HOUR = 8;
const END_HOUR = 22;
const MAX_BAR_HEIGHT = 44;
const BAR_WIDTH = 14;

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
// with its busiest-window label. Renders nothing without history — a court
// with no baseline has nothing meaningful to plot. Reused by Task 14.
export function PopularTimes({ forecast }: { forecast: CourtForecast | undefined }) {
  const t = useTheme();
  if (!forecast?.has_history) return null;

  const hours = forecast.hours;
  const peak = Math.max(...hours, 0);
  const win = busiestWindow(hours);

  const bars: number[] = [];
  for (let h = START_HOUR; h <= END_HOUR; h++) bars.push(h);

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Overline>Popular Times</Overline>
        {win ? (
          <Text style={[t.type.caption, styles.caption, { color: t.colors.textSecondary }]}>
            busiest {windowLabel(win)}
          </Text>
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
            <View
              key={h}
              style={{
                width: BAR_WIDTH,
                height,
                borderRadius: 3,
                backgroundColor: color,
              }}
            />
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
  chart: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: MAX_BAR_HEIGHT,
  },
});
