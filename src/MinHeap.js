export class MinHeap {
  constructor(compare) {
    this.data = [];
    this.compare = compare;
  }

  push(item) {
    this.data.push(item);
    this._bubbleUp();
  }

  pop() {
    if (this.data.length === 1) return this.data.pop();
    const top = this.data[0];
    this.data[0] = this.data.pop();
    this._bubbleDown();
    return top;
  }

  isEmpty() {
    return this.data.length === 0;
  }

  _bubbleUp() {
    let i = this.data.length - 1;
    const item = this.data[i];
    while (i > 0) {
      const parentIndex = Math.floor((i - 1) / 2);
      const parent = this.data[parentIndex];
      if (this.compare(item, parent) >= 0) break;
      this.data[i] = parent;
      this.data[parentIndex] = item;
      i = parentIndex;
    }
  }

  _bubbleDown() {
    let i = 0;
    const length = this.data.length;
    const item = this.data[0];
    while (true) {
      let left = 2 * i + 1;
      let right = 2 * i + 2;
      let swap = null;

      if (left < length && this.compare(this.data[left], item) < 0) swap = left;
      if (
        right < length &&
        this.compare(this.data[right], swap === null ? item : this.data[left]) < 0
      )
        swap = right;
      if (swap === null) break;
      this.data[i] = this.data[swap];
      this.data[swap] = item;
      i = swap;
    }
  }
}