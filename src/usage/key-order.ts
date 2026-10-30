/** Action ids in order of first appearance. */
export class KeyOrder {
  private readonly order: string[] = [];

  add(id: string): void {
    if (!this.order.includes(id)) this.order.push(id);
  }

  remove(id: string): void {
    const i = this.order.indexOf(id);
    if (i >= 0) this.order.splice(i, 1);
  }

  ids(): string[] {
    return [...this.order];
  }

  isEmpty(): boolean {
    return this.order.length === 0;
  }
}
