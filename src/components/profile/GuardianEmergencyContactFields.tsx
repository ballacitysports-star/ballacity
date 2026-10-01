import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, Input } from "@/components/profile/ProfileFormPrimitives";
import { isValidPhone } from "@/lib/org-listing";
import { useMyEmergencyContact } from "@/lib/guardian-emergency-contact";

/**
 * Emergency contact, private to the guardian themself — never shown on a
 * profile to anyone else (see GuardianProfileView's About sheet, the only
 * other place these values are read). Saves on its own, separate from this
 * screen's shared autosave: relationship is free text, not the
 * GUARDIAN_RELATIONSHIPS set used for a child's relationship to a parent.
 */
export function GuardianEmergencyContactFields() {
  const { value, loading, saving, save } = useMyEmergencyContact();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setName(value.name);
    setPhone(value.phone);
    setRelationship(value.relationship);
  }, [value, dirty]);

  const phoneError = phone.trim() && !isValidPhone(phone) ? "Phone number looks invalid" : null;

  const onSave = async () => {
    if (phoneError) return;
    try {
      await save({ name, phone, relationship });
      setDirty(false);
      toast.success("Emergency contact saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save emergency contact");
    }
  };

  if (loading) return null;

  return (
    <div>
      <p className="mb-3 text-xs text-muted-foreground">
        Visible only to you — never shown on your profile to anyone else.
      </p>
      <Field label="Name">
        <Input
          value={name}
          onChange={(v) => {
            setDirty(true);
            setName(v);
          }}
          placeholder="Who should we contact?"
          maxLength={100}
        />
      </Field>
      <Field label="Phone">
        <Input
          value={phone}
          onChange={(v) => {
            setDirty(true);
            setPhone(v);
          }}
          placeholder="(555) 555-0100"
          inputMode="tel"
          maxLength={40}
        />
      </Field>
      {phoneError && <p className="-mt-2 mb-3 text-xs text-destructive">{phoneError}</p>}
      <Field label="Relationship">
        <Input
          value={relationship}
          onChange={(v) => {
            setDirty(true);
            setRelationship(v);
          }}
          placeholder="Spouse, co-parent, sibling…"
          maxLength={60}
        />
      </Field>
      <button
        onClick={onSave}
        disabled={saving || !!phoneError}
        className="rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
