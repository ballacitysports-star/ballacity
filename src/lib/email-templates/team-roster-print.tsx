import * as React from "react";
import { Body, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";
import type { TemplateEntry } from "./registry";

interface RosterPlayer {
  name: string;
  position?: string;
  jersey?: string | number | null;
}

interface Props {
  teamName?: string;
  tryoutTitle?: string;
  when?: string;
  location?: string;
  players?: RosterPlayer[];
}

const TeamRosterPrintEmail = ({ teamName, tryoutTitle, when, location, players }: Props) => {
  const team = teamName || "Your team";
  const list = players ?? [];
  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>{`${team} roster — print and bring to ${tryoutTitle || "the first tryout"}`}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>{team} — Team Roster</Heading>
          <Text style={text}>
            Print this roster and bring it to {tryoutTitle || "the first tryout"}.
          </Text>
          {when ? <Text style={detail}><strong>When:</strong> {when}</Text> : null}
          {location ? <Text style={detail}><strong>Where:</strong> {location}</Text> : null}
          <Section style={tableWrap}>
            <table style={table} cellPadding={0} cellSpacing={0} width="100%">
              <thead>
                <tr>
                  <th style={th}>#</th>
                  <th style={th}>Player</th>
                  <th style={th}>Position</th>
                  <th style={{ ...th, textAlign: "right" as const }}>Jersey</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p, i) => (
                  <tr key={i}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}><strong>{p.name}</strong></td>
                    <td style={td}>{p.position || "—"}</td>
                    <td style={{ ...td, textAlign: "right" as const }}>{p.jersey ? `#${p.jersey}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Text style={footer}>
            Sent by {team} on BallaCity. Open this email on any device and use your browser's Print option.
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

export const template = {
  component: TeamRosterPrintEmail,
  subject: (d: Record<string, any>) => `${d.teamName || "Team"} roster — bring to ${d.tryoutTitle || "tryouts"}`,
  displayName: "Printable team roster",
  previewData: {
    teamName: "BallaCity",
    tryoutTitle: "BallaCity 14U Tryouts",
    when: "Sat, Oct 17, 2026, 10:00 AM",
    location: "Bogan Park",
    players: [
      { name: "Nathaniel", position: "Pitcher", jersey: 12 },
      { name: "Jordan", position: "Shortstop", jersey: 7 },
      { name: "Alex", position: "Catcher", jersey: null },
    ],
  },
} satisfies TemplateEntry;

const main = { backgroundColor: "#ffffff", fontFamily: "Arial, sans-serif" };
const container = { padding: "20px 25px" };
const h1 = { fontSize: "22px", fontWeight: "bold" as const, color: "#000000", margin: "0 0 12px" };
const text = { fontSize: "14px", color: "#55575d", lineHeight: "1.5", margin: "0 0 16px" };
const detail = { fontSize: "15px", color: "#000000", lineHeight: "1.5", margin: "0 0 8px" };
const tableWrap = { margin: "16px 0 0" };
const table = { borderCollapse: "collapse" as const, border: "1px solid #e5e7eb" };
const th = {
  fontSize: "12px", textTransform: "uppercase" as const, letterSpacing: "0.05em",
  color: "#55575d", textAlign: "left" as const, padding: "8px 10px",
  borderBottom: "2px solid #000000", backgroundColor: "#f6f6f6",
};
const td = { fontSize: "14px", color: "#000000", padding: "8px 10px", borderBottom: "1px solid #e5e7eb" };
const footer = { fontSize: "12px", color: "#999999", margin: "24px 0 0", lineHeight: "1.5" };
