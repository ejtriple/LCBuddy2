import Packet from '#/io/Packet.js';

import Envelope from '#/sound/Envelope.js';

export default class Filter {
    unity: number = 0.0;
    unity16: number = 0;
    pairs: Int32Array = new Int32Array(2);
    frequencies: Int32Array[][] = new Array(2);
    ranges: Int32Array[][] = new Array(2);
    unities: Int32Array = new Int32Array(2);

    unpack(buf: Packet, envelope: Envelope) {
        const count = buf.g1();
        this.pairs[0] = count >> 4;
        this.pairs[1] = count & 0xF;

        if (count !== 0) {
            this.unities[0] = buf.g2();
            this.unities[1] = buf.g2();

            const migration = buf.g1();

            for (let direction = 0; direction < 2; direction++) {
                if (!this.frequencies[direction]) {
                    this.frequencies[direction] = new Array(2);
                    this.frequencies[direction][0] = new Int32Array(4);
                    this.frequencies[direction][1] = new Int32Array(4);
                }

                if (!this.ranges[direction]) {
                    this.ranges[direction] = new Array(2);
                    this.ranges[direction][0] = new Int32Array(4);
                    this.ranges[direction][1] = new Int32Array(4);
                }

                for (let pair = 0; pair < this.pairs[direction]; pair++) {
                    this.frequencies[direction][0][pair] = buf.g2();
                    this.ranges[direction][0][pair] = buf.g2();
                }
            }

            for (let direction = 0; direction < 2; direction++) {
                for (let pair = 0; pair < this.pairs[direction]; pair++) {
                    if ((migration & (1 << (direction * 4) << pair)) !== 0) {
                        this.frequencies[direction][1][pair] = buf.g2();
                        this.ranges[direction][1][pair] = buf.g2();
                    } else {
                        this.frequencies[direction][1][pair] = this.frequencies[direction][0][pair];
                        this.ranges[direction][1][pair] = this.ranges[direction][0][pair];
                    }
                }
            }

            if (migration !== 0 || this.unities[1] !== this.unities[0]) {
                envelope.unpackPoints(buf);
            }
        } else {
            this.unities[0] = this.unities[1] = 0;
        }
    }
}
