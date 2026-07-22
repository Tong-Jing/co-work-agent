export interface Observation {
  tool: string;
  summary: string;
  succeeded: boolean;
}

export class WorkingMemory {
  readonly observations: Observation[] = [];

  addObservation(observation: Observation) {
    this.observations.push(observation);
  }
}
