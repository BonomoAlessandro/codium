// Art einer Java-Datei für ihr Symbol im Dateibaum (Ticket 32): die reine Funktion, Text rein, Art raus.

import { describe, expect, it } from 'vitest';
import { javaKindOf } from '../../src/main/core/javaKind';

/** Ein üblicher Dateianfang: Lizenzkommentar, Paket, Importe, Javadoc und Annotationen vor dem Typ. */
const PREAMBLE = `/*
 * Copyright (c) Beispiel. Hier steht class Fake {} nur im Kommentar.
 */
package ch.example.shop.order;

import java.util.List;
import java.util.*;
import static java.util.Objects.requireNonNull;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Bestellungen. {@code interface Nope {}} und <b>enum</b> im Javadoc zählen nicht.
 */
@SuppressWarnings({"unchecked", "rawtypes"})
@Table(name = "orders(", schema = ")")
@ch.example.Marker
`;

describe('Art einer Java-Datei', () => {
  describe('erkennt jede Art', () => {
    it.each([
      ['class', 'public class OrderService {}'],
      ['abstractClass', 'public abstract class OrderService {}'],
      ['interface', 'public interface OrderService {}'],
      ['enum', 'public enum OrderService { NEW, PAID }'],
      ['record', 'public record OrderService(String id, int amount) {}'],
      ['annotation', 'public @interface OrderService { String value(); }'],
      ['exception', 'public class OrderService extends RuntimeException {}'],
      ['abstractException', 'public abstract class OrderService extends Exception {}'],
    ] as const)('%s', (kind, declaration) => {
      expect(javaKindOf(declaration, 'OrderService.java')).toBe(kind);
      expect(javaKindOf(PREAMBLE + declaration, 'OrderService.java')).toBe(kind);
    });

    it('mit Modifikatoren in jeder Reihenfolge, auch zwischen Annotationen', () => {
      expect(javaKindOf('final public class A {}', 'A.java')).toBe('class');
      expect(javaKindOf('public sealed class A permits B, C {}', 'A.java')).toBe('class');
      expect(javaKindOf('public non-sealed class A extends Base {}', 'A.java')).toBe('class');
      expect(javaKindOf('non - sealed class A {}', 'A.java')).toBe('class');
      expect(javaKindOf('strictfp class A {}', 'A.java')).toBe('class');
      expect(javaKindOf('@Entity public @Deprecated(since = "1") abstract class A {}', 'A.java')).toBe('abstractClass');
      expect(javaKindOf('abstract sealed class A permits B {}', 'A.java')).toBe('abstractClass');
      expect(javaKindOf('public sealed interface A permits B, C {}', 'A.java')).toBe('interface');
      expect(javaKindOf('public abstract interface A {}', 'A.java')).toBe('interface');
      expect(javaKindOf('public final record A(int x) {}', 'A.java')).toBe('record');
      expect(javaKindOf('public @ interface A {}', 'A.java')).toBe('annotation');
    });

    it('mit Generics', () => {
      expect(javaKindOf('public class Box<T extends Comparable<? super T>> implements Supplier<T> {}', 'Box.java')).toBe('class');
      expect(javaKindOf('public interface Repo<T, ID extends Serializable> extends Base<T> {}', 'Repo.java')).toBe('interface');
      expect(javaKindOf('public record Pair<A, B>(A first, @NonNull B second) implements Comparable<Pair<A, B>> {}', 'Pair.java')).toBe('record');
      expect(javaKindOf('public enum Color implements Supplier<Map<String, List<Integer>>> { RED }', 'Color.java')).toBe('enum');
      expect(javaKindOf('class Failure<T> extends BaseException<T, List<T>> {}', 'Failure.java')).toBe('exception');
    });

    it('eine Ausnahme am Namen der Oberklasse', () => {
      expect(javaKindOf('class A extends Exception {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends IllegalStateException {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends java.io.IOException {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends Error {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends AssertionError {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends Throwable {}', 'A.java')).toBe('exception');
      expect(javaKindOf('class A extends @NonNull ShopException implements Serializable {}', 'A.java')).toBe('exception');
      // Nur die Oberklasse zählt: nicht der eigene Name, nicht Interfaces, nicht Grenzen von Typparametern.
      expect(javaKindOf('class OrderException {}', 'OrderException.java')).toBe('class');
      expect(javaKindOf('class A implements ShopException {}', 'A.java')).toBe('class');
      expect(javaKindOf('class A<T extends Exception> extends Base {}', 'A.java')).toBe('class');
      expect(javaKindOf('class A extends ExceptionHandler {}', 'A.java')).toBe('class');
      expect(javaKindOf('interface A extends ShopException {}', 'A.java')).toBe('interface');
    });

    it('einen Typ, dessen Rumpf innere Typen, Strings und Zeichen mit Klammern enthält', () => {
      const text = `public class Outer {
  interface Inner {}
  enum State { A { void f() {} }, B }
  static class Nested extends RuntimeException {}
  String s = "} class Fake {";
  char open = '{', close = '}', quote = '\\'', backslash = '\\\\';
  String escaped = "\\" } \\"";
  String block = """
      } interface Fake2 { "" \\""" }
      """;
  // } class Fake3 {
  /* } class Fake4 { */
  void f() { if (true) { g(); } }
}
`;
      expect(javaKindOf(text, 'Outer.java')).toBe('class');
    });

    it('mit Byte-Order-Mark, Windows-Zeilenenden und Namen mit Umlauten', () => {
      expect(javaKindOf('﻿package a;\r\n\r\npublic class A {\r\n}\r\n', 'A.java')).toBe('class');
      expect(javaKindOf('public class Grösse {}', 'Grösse.java')).toBe('class');
      expect(javaKindOf('public interface Ä$_1 {}', 'Ä$_1.java')).toBe('interface');
    });

    it('mit Endung in anderer Schreibweise', () => {
      expect(javaKindOf('class A {}', 'A.JAVA')).toBe('class');
    });
  });

  describe('Kommentare und Strings täuschen nicht', () => {
    it('Deklarationen in Kommentaren vor dem Typ', () => {
      const text = `// public class A {}
/* public interface A {} */
/** public enum A { X } */
public record A(int x) {}`;
      expect(javaKindOf(text, 'A.java')).toBe('record');
    });

    it('nur auskommentiert heisst: kein Typ', () => {
      expect(javaKindOf('// public class A {}\n/* class A {} */', 'A.java')).toBe('java');
    });

    it('Deklarationen in Strings und Textblöcken von Annotationen', () => {
      const text = `@Query("interface A {}")
@Sql("""
    class B { } enum C { }
    """)
@Doc('}')
public class A {}`;
      expect(javaKindOf(text, 'A.java')).toBe('class');
    });

    it('ein zweiter Typ nur im String oder Kommentar nach dem ersten', () => {
      expect(javaKindOf('class A {}\n// class B {}\n/* class C {} */', 'A.java')).toBe('class');
    });
  });

  describe('ohne eindeutige Art: Java-Datei', () => {
    it('ein Name, der nicht zur Datei passt, auch nur in der Schreibweise', () => {
      expect(javaKindOf('public class Other {}', 'OrderService.java')).toBe('java');
      expect(javaKindOf('public class OrderService {}', 'orderService.java')).toBe('java');
    });

    it('mehrere oberste Typen, öffentlich oder nicht', () => {
      expect(javaKindOf('public class A {}\nclass Helper {}', 'A.java')).toBe('java');
      expect(javaKindOf('class Helper {}\npublic class A {}', 'A.java')).toBe('java');
      expect(javaKindOf('public class A {}; public interface B {}', 'A.java')).toBe('java');
      expect(javaKindOf(`${PREAMBLE}public enum A { X }\nrecord B(int y) {}\n`, 'A.java')).toBe('java');
    });

    it('eine leere Datei, nur Leerraum oder nur Kommentare', () => {
      expect(javaKindOf('', 'A.java')).toBe('java');
      expect(javaKindOf(' \r\n\t\n', 'A.java')).toBe('java');
      expect(javaKindOf('/** Nur Javadoc. */\n// und ein Kommentar\n', 'A.java')).toBe('java');
    });

    it('package-info.java und module-info.java', () => {
      expect(javaKindOf('/** Paket. */\n@NonNullApi\npackage ch.example.shop;\n\nimport a.NonNullApi;\n', 'package-info.java')).toBe('java');
      expect(javaKindOf('module ch.example.shop {\n  requires java.sql;\n  exports ch.example.shop;\n}\n', 'module-info.java')).toBe('java');
      expect(javaKindOf('import a.B;\n@Deprecated open module shop { opens x; }\n', 'module-info.java')).toBe('java');
    });

    it('eine Datei ohne Klasse (implizite Klasse mit main)', () => {
      expect(javaKindOf('void main() {\n  System.out.println("class A {}");\n}\n', 'A.java')).toBe('java');
    });

    it.each([
      ['Tippfehler im Schlüsselwort', 'public clas A {}'],
      ['Typ ohne Schlüsselwort', 'public A {}'],
      ['Paket ohne Semikolon', 'package a.b\npublic class A {}'],
      ['Import ohne Semikolon', 'import java.util.List\npublic class A {}'],
      ['Import nach dem Paket fehlerhaft', 'package a; import ;\nclass A {}'],
      ['Typ ohne Namen', 'public class {}'],
      ['Schlüsselwort als Name', 'public class enum {}'],
      ['Semikolon im Kopf', 'public class A extends B; {}'],
      ['schliessende Klammer im Kopf', 'public class A } {'],
      ['Kopf ohne Rumpf', 'public class A extends B'],
      ['Modifikator ohne Typ', 'public final'],
      ['Annotation ohne Namen', '@ public class A {}'],
      ['Annotation mit offener Klammer', '@Foo(public class A {}'],
      ['record ohne Komponenten', 'record A {}'],
      ['offener Blockkommentar', '/* public class A {}'],
      ['offener String in einer Annotation', '@Foo("class A {}\n'],
      ['Satzzeichen am Anfang', '} class A {}'],
      ['Modifikator vor dem Paket', 'public package a; class A {}'],
    ])('ein Syntaxfehler am Anfang: %s', (_name, text) => {
      expect(() => javaKindOf(text, 'A.java')).not.toThrow();
      expect(javaKindOf(text, 'A.java')).toBe('java');
    });

    it('Unsinn und Binärdaten, ohne Ausnahme', () => {
      const noise = Array.from({ length: 4000 }, (_, i) => String.fromCharCode((i * 7919) % 65536)).join('');
      expect(() => javaKindOf(noise, 'A.java')).not.toThrow();
      expect(javaKindOf('\u0000\u0001\u0002class A {}', 'A.java')).toBe('java');
      expect(javaKindOf('"""', 'A.java')).toBe('java');
      expect(javaKindOf("'", 'A.java')).toBe('java');
    });
  });

  describe('Fehlertoleranz nach dem Kopf des ersten Typs', () => {
    it('endet der Text im Rumpf (abgeschnitten oder offene Klammer), zählt der Typ', () => {
      expect(javaKindOf('public class A {\n  void f() {\n', 'A.java')).toBe('class');
      expect(javaKindOf('public interface A {\n  String s = "', 'A.java')).toBe('interface');
      expect(javaKindOf('public class A {\n  /* offen', 'A.java')).toBe('class');
      expect(javaKindOf(`public enum A {\n${'  X,\n'.repeat(20_000)}`, 'A.java')).toBe('enum');
    });

    it('Unerwartetes nach dem ersten vollständigen Typ beendet das Lesen', () => {
      expect(javaKindOf('public class A {}\n}\n', 'A.java')).toBe('class');
      expect(javaKindOf('public class A {}\nimport x.Y;\nclass B {}', 'A.java')).toBe('class');
    });
  });
});
