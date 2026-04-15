## LinkedList — singly-linked list

A singly-linked list demonstrating nullable references, unwrap, type tests,
and recursive struct types in wac.

(This is an example only, not to be included in the language.)

### Implementation

```wac
struct Node {
  i32 val;
  Node? next;
}

struct LinkedList {
  Node? head;
  Node? tail;
  i32 count;

  LinkedList create() {
    return LinkedList();
  }

  void push_front(this, i32 val) {
    Node n = Node(val, this.head);
    this.head = n;
    if (this.tail is null) {
      this.tail = n;
    }
    this.count++;
  }

  void push_back(this, i32 val) {
    Node n = Node(val, null);
    if (this.tail is not null) {
      this.tail!.next = n;
    } else {
      this.head = n;
    }
    this.tail = n;
    this.count++;
  }

  i32 pop_front(this) {
    if (this.head is null) { trap; }
    i32 val = this.head!.val;
    this.head = this.head!.next;
    if (this.head is null) {
      this.tail = null;
    }
    this.count--;
    return val;
  }

  i32 front(const this) {
    if (this.head is null) { trap; }
    return this.head!.val;
  }

  i32 back(const this) {
    if (this.tail is null) { trap; }
    return this.tail!.val;
  }

  i32 len(const this) {
    return this.count;
  }

  i32 sum(const this) {
    i32 total = 0;
    Node? cur = this.head;
    while (cur is not null) {
      total += cur!.val;
      cur = cur!.next;
    }
    return total;
  }

  void reverse(this) {
    Node? prev = null;
    Node? cur = this.head;
    this.tail = this.head;
    while (cur is not null) {
      Node c = cur!;
      Node? next = c.next;
      c.next = prev;
      prev = c;
      cur = next;
    }
    this.head = prev;
  }
}
```

### Spec tests

```wac
export i32 testPushFront() {
  LinkedList l = LinkedList.create();
  l.push_front(10);
  l.push_front(20);
  l.push_front(30);
  return l.front();
}
```

`[§wac-ll-push-front-k4mf2js]` `testPushFront()` returns `30`.

```wac
export i32 testPushBack() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  return l.back();
}
```

`[§wac-ll-push-back-p9qn3xl]` `testPushBack()` returns `30`.

```wac
export i32 testLen() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  return l.len();
}
```

`[§wac-ll-len-w7rk5bt]` `testLen()` returns `3`.

```wac
export i32 testLenEmpty() {
  LinkedList l = LinkedList.create();
  return l.len();
}
```

`[§wac-ll-len-empty-m3hd8qz]` `testLenEmpty()` returns `0`.

```wac
export i32 testSum() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  return l.sum();
}
```

`[§wac-ll-sum-j2fn9rk]` `testSum()` returns `60`.

```wac
export i32 testPopFront() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  i32 first = l.pop_front();
  return first * 100 + l.len();
}
```

`[§wac-ll-pop-front-h8wd2pm]` `testPopFront()` returns `1002` (first=10, len=2).

```wac
export i32 testPopFrontAll() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  i32 a = l.pop_front();
  i32 b = l.pop_front();
  return a * 100 + b * 10 + l.len();
}
```

`[§wac-ll-pop-all-f4kp7wn]` `testPopFrontAll()` returns `1200` (a=10, b=20,
len=0).

```wac
export i32 testPopEmpty() {
  LinkedList l = LinkedList.create();
  return l.pop_front();
}
```

`[§wac-ll-pop-empty-n2qm8xl]` `testPopEmpty()` traps: pop on empty list.

```wac
export i32 testReverse() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  l.reverse();
  return l.front() * 100 + l.back();
}
```

`[§wac-ll-reverse-c7jw3kf]` `testReverse()` returns `3010` (front=30, back=10).

```wac
export i32 testFrontBack() {
  LinkedList l = LinkedList.create();
  l.push_front(10);
  l.push_back(20);
  return l.front() * 100 + l.back();
}
```

`[§wac-ll-front-back-q8kn2wp]` `testFrontBack()` returns `1020`.
