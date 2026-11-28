// The brokers the MT5 connect form offers. Pure and browser-safe.
// The server name must match the one on the broker's MT5 login screen; Vantage's names below are
// the usual ones, and the Boss can still type a different name in the server box.

export type Broker = {
  id: string;
  name: string;
  /** Servers offered for this broker (the box stays editable). */
  servers: string[];
};

export const BROKERS: Broker[] = [
  {
    id: "vantage",
    name: "Vantage Markets Pty",
    servers: ["Vantage-Demo", "Vantage-Live", "Vantage International-Live", "Vantage International-Demo"],
  },
  { id: "other", name: "Other broker (type the server)", servers: [] },
];

export const brokerById = (id: string): Broker | undefined => BROKERS.find((b) => b.id === id);
