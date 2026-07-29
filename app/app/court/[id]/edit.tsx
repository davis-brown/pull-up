import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { AuthGate } from "@/components/AuthGate";
import { Button, Chip, ErrorText, FullScreenLoader } from "@/components/ui";
import { QueryError } from "@/components/QueryError";
import {
  feeAmountToInput,
  isCurrencyCode,
  MAX_FEE_AMOUNT_CENTS,
  parseFeeInput,
} from "@/lib/court-cost";
import { useCourt, usePatchCourtAttributes } from "@/lib/hooks";
import { parseRouteId } from "@/lib/routes";
import { useTheme } from "@/lib/theme";
import type { CourtDetail, Surface } from "@/lib/types";

const surfaces: Surface[] = ["asphalt", "concrete", "hardwood", "rubber", "other"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const accessOptions: Array<{ value: NonNullable<CourtDetail["access"]>; label: string }> = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
  { value: "customers", label: "Customers/members" },
];

type ToggleKey =
  | "lighting"
  | "indoor"
  | "covered"
  | "fee"
  | "drinking_water"
  | "toilets"
  | "parking"
  | "fenced";

const toggles: Array<{ key: ToggleKey; label: string }> = [
  { key: "lighting", label: "Lights" },
  { key: "indoor", label: "Indoor" },
  { key: "covered", label: "Covered" },
  { key: "fee", label: "Fee to play" },
  { key: "drinking_water", label: "Water" },
  { key: "toilets", label: "Restroom" },
  { key: "parking", label: "Parking" },
  { key: "fenced", label: "Fenced" },
];

export default function EditCourtScreen() {
  const params = useLocalSearchParams();
  const id = parseRouteId(params.id);
  if (!id) {
    return (
      <QueryError
        error={new Error("Invalid court id")}
        title="Invalid court link"
        message="This court link is not valid."
      />
    );
  }
  return (
    <AuthGate>
      <EditCourtContent id={id} />
    </AuthGate>
  );
}

function EditCourtContent({ id }: { id: string }) {
  const router = useRouter();
  const t = useTheme();
  const { data: court, isLoading, error, refetch } = useCourt(id);

  if (error && !court) {
    return (
      <View style={[styles.center, { backgroundColor: t.colors.background }]}>
        <QueryError error={error} onRetry={() => void refetch()} />
      </View>
    );
  }

  if (isLoading || !court) {
    return <FullScreenLoader />;
  }

  return <EditForm court={court} courtId={id} onSaved={() => router.back()} />;
}

function EditForm({
  court,
  courtId,
  onSaved,
}: {
  court: CourtDetail;
  courtId: string;
  onSaved: () => void;
}) {
  const t = useTheme();
  const patch = usePatchCourtAttributes(courtId);
  const [surface, setSurface] = useState<Surface | null>(court.surface);
  const [access, setAccess] = useState<CourtDetail["access"]>(court.access);
  const [hoopCount, setHoopCount] = useState<number | null>(court.hoop_count);
  const [feeAmount, setFeeAmount] = useState(feeAmountToInput(court));
  const [feeCurrency, setFeeCurrency] = useState(court.fee_currency ?? "USD");
  const [feeNote, setFeeNote] = useState(court.fee_note ?? "");
  const [toggleState, setToggleState] = useState<Record<ToggleKey, boolean>>({
    lighting: !!court.lighting,
    indoor: !!court.indoor,
    covered: !!court.covered,
    fee: !!court.fee,
    drinking_water: !!court.drinking_water,
    toilets: !!court.toilets,
    parking: !!court.parking,
    fenced: !!court.fenced,
  });
  const [error, setError] = useState<string | null>(null);

  const setToggle = (key: ToggleKey) =>
    setToggleState((prev) => ({ ...prev, [key]: !prev[key] }));

  const bumpHoops = (delta: number) =>
    setHoopCount((prev) => {
      const next = (prev ?? 0) + delta;
      return Math.max(0, Math.min(20, next));
    });

  const currencyCode = feeCurrency.trim().toUpperCase();
  const amountCents = parseFeeInput(feeAmount, currencyCode);
  // Empty is "no price given"; non-empty but unparseable is a mistake worth
  // blocking on, so the two are distinguished before save.
  const amountInvalid = feeAmount.trim() !== "" && amountCents === null;
  const currencyInvalid = feeAmount.trim() !== "" && !isCurrencyCode(currencyCode);

  const save = () => {
    setError(null);
    if (toggleState.fee && amountInvalid) {
      setError(`Enter a price between 0 and ${MAX_FEE_AMOUNT_CENTS / 100}, or leave it blank.`);
      return;
    }
    if (toggleState.fee && currencyInvalid) {
      setError("Currency must be a 3-letter code, like USD or EUR.");
      return;
    }
    const changes: Partial<CourtDetail> = {};
    if (surface !== court.surface) changes.surface = surface;
    if (access !== court.access) changes.access = access;
    if (hoopCount !== court.hoop_count) changes.hoop_count = hoopCount;
    for (const { key } of toggles) {
      const before = !!court[key];
      if (toggleState[key] !== before) {
        (changes as Record<string, unknown>)[key] = toggleState[key];
      }
    }
    // Price only travels with a fee. Turning the fee off leaves the stored
    // amount alone — the patch endpoint coalesces, so it cannot be cleared —
    // but nothing reads it while fee is false.
    if (toggleState.fee) {
      if (amountCents !== null && amountCents !== court.fee_amount_cents) {
        changes.fee_amount_cents = amountCents;
        changes.fee_currency = currencyCode;
      }
      const note = feeNote.trim();
      if (note !== (court.fee_note ?? "")) changes.fee_note = note;
    }
    if (Object.keys(changes).length === 0) {
      onSaved();
      return;
    }
    patch.mutate(changes, {
      onSuccess: () => onSaved(),
      onError: (e) => setError(e.message),
    });
  };

  return (
    <ScrollView
      style={{ backgroundColor: t.colors.background }}
      contentContainerStyle={{ padding: t.spacing.lg }}
    >
        <Text style={[t.type.label, { color: t.colors.textSecondary, marginBottom: t.spacing.sm }]}>
          Surface
        </Text>
        <View style={styles.chips}>
          {surfaces.map((s) => (
            <Chip
              key={s}
              label={cap(s)}
              selected={surface === s}
              onPress={() => setSurface(s)}
            />
          ))}
        </View>

        <Text
          style={[
            t.type.label,
            { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
          ]}
        >
          Amenities
        </Text>
        <View style={styles.chips}>
          {toggles.map(({ key, label }) => (
            <Chip
              key={key}
              label={label}
              selected={toggleState[key]}
              onPress={() => setToggle(key)}
            />
          ))}
        </View>

        {/* Only meaningful once the court is marked as charging. */}
        {toggleState.fee && (
          <>
            <Text
              style={[
                t.type.label,
                { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
              ]}
            >
              Price
            </Text>
            <View style={styles.priceRow}>
              <TextInput
                value={feeAmount}
                onChangeText={setFeeAmount}
                placeholder="5.00"
                placeholderTextColor={t.colors.textMuted}
                keyboardType="decimal-pad"
                accessibilityLabel="Price to play"
                style={[
                  styles.input,
                  styles.amountInput,
                  {
                    borderColor: amountInvalid ? t.colors.warning : t.colors.border,
                    color: t.colors.textPrimary,
                    backgroundColor: t.colors.surface,
                  },
                ]}
              />
              <TextInput
                value={feeCurrency}
                onChangeText={setFeeCurrency}
                placeholder="USD"
                placeholderTextColor={t.colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={3}
                accessibilityLabel="Currency code"
                style={[
                  styles.input,
                  styles.currencyInput,
                  {
                    borderColor: currencyInvalid ? t.colors.warning : t.colors.border,
                    color: t.colors.textPrimary,
                    backgroundColor: t.colors.surface,
                  },
                ]}
              />
            </View>
            <TextInput
              value={feeNote}
              onChangeText={setFeeNote}
              placeholder="drop-in, per hour, members free…"
              placeholderTextColor={t.colors.textMuted}
              maxLength={80}
              accessibilityLabel="Price note"
              style={[
                styles.input,
                {
                  marginTop: t.spacing.sm,
                  borderColor: t.colors.border,
                  color: t.colors.textPrimary,
                  backgroundColor: t.colors.surface,
                },
              ]}
            />
          </>
        )}

        <Text
          style={[
            t.type.label,
            { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
          ]}
        >
          Access
        </Text>
        <View style={styles.chips}>
          {accessOptions.map((opt) => (
            <Chip
              key={opt.value}
              label={opt.label}
              selected={access === opt.value}
              onPress={() => setAccess(opt.value)}
            />
          ))}
        </View>

        <Text
          style={[
            t.type.label,
            { color: t.colors.textSecondary, marginTop: t.spacing.md, marginBottom: t.spacing.sm },
          ]}
        >
          Hoops
        </Text>
        <View style={styles.stepper}>
          <Button title="−" variant="secondary" onPress={() => bumpHoops(-1)} />
          <Text style={[t.type.heading, { color: t.colors.textPrimary, minWidth: 40, textAlign: "center" }]}>
            {hoopCount ?? 0}
          </Text>
          <Button title="+" variant="secondary" onPress={() => bumpHoops(1)} />
        </View>

        <ErrorText message={error} />
        <Button
          title="Save"
          busy={patch.isPending}
          onPress={save}
        />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 },
  priceRow: { flexDirection: "row", gap: 8 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  amountInput: { flex: 1 },
  currencyInput: { width: 80, textAlign: "center" },
});
