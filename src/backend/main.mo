import Int "mo:core/Int";
import Time "mo:core/Time";
import Array "mo:core/Array";
import Order "mo:core/Order";
import Map "mo:core/Map";

actor {
  type LeaderboardEntry = {
    name : Text;
    score : Nat;
    timestamp : Int;
  };

  module LeaderboardEntry {
    public func compareByScore(a : LeaderboardEntry, b : LeaderboardEntry) : Order.Order {
      Int.compare(b.score, a.score);
    };
  };

  let entriesMap = Map.empty<Text, LeaderboardEntry>();

  public shared ({ caller }) func submitScore(name : Text, score : Nat) : async Bool {
    let timestamp = Time.now();

    let newEntry : LeaderboardEntry = {
      name;
      score;
      timestamp;
    };

    let existingEntries = getLeaderboardSync();
    let eligibleEntries = existingEntries.filter(
      func(entry) { entry.score > score }
    );

    if (eligibleEntries.size() >= 10) {
      return false;
    };

    let updatedEntries = existingEntries.concat([newEntry]).sort(LeaderboardEntry.compareByScore);

    let top10Entries = if (updatedEntries.size() > 10) {
      updatedEntries.sliceToArray(0, 10);
    } else {
      updatedEntries;
    };

    entriesMap.clear();
    for (entry in top10Entries.values()) {
      entriesMap.add(entry.name, entry);
    };
    true;
  };

  public query ({ caller }) func getLeaderboard() : async [LeaderboardEntry] {
    getLeaderboardSync();
  };

  public query ({ caller }) func getPersonalBest(name : Text) : async ?Nat {
    switch (entriesMap.get(name)) {
      case (?entry) { ?entry.score };
      case (null) { null };
    };
  };

  func getLeaderboardSync() : [LeaderboardEntry] {
    entriesMap.values().toArray().sort(LeaderboardEntry.compareByScore);
  };
};
